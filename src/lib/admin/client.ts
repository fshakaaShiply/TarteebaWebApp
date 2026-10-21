import createClient from "openapi-fetch";
import type { paths } from "@/lib/api/schema";
import { defaultLocale, isLocale, localeCookie } from "@/i18n/config";

/*
 * Admin API access (A01–A13). The browser only talks to this web origin: the Route Handler
 * src/app/backend/[...path]/route.ts forwards /backend/api/* and /backend/sanctum/csrf-cookie to API_INTERNAL_URL, so
 * the Sanctum session and XSRF cookies are first-party cookies of the admin web. Separate from the public client in
 * src/lib/api/client.ts.
 *
 *   - credentials "include" on every call (session cookie);
 *   - mutating calls first make sure an XSRF-TOKEN cookie exists (GET /backend/sanctum/csrf-cookie) and send its
 *     decoded value as X-XSRF-TOKEN; a 419 (stale token) refreshes the cookie and retries once;
 *   - Accept-Language follows the current UI locale, so API messages come back in the same language;
 *   - 401 and 403 TWO_FACTOR_SETUP_REQUIRED are reported to the session (lib/admin/session.tsx), which redirects.
 */

export const ADMIN_API_BASE = "/backend/api";
export const CSRF_COOKIE_URL = "/backend/sanctum/csrf-cookie";
export const XSRF_COOKIE = "XSRF-TOKEN";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The API error envelope: {"error": {"code", "message", "details"}} (spec §4.5). */
export type ApiErrorBody = {
  code: string;
  message: string;
  details: Record<string, unknown>;
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody, options?: { cause?: unknown }) {
    super(body.message || body.code, options);
    this.name = "AdminApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  static network(cause?: unknown): AdminApiError {
    return new AdminApiError(0, { code: "NETWORK_ERROR", message: "", details: {} }, { cause });
  }

  /** VALIDATION_FAILED field messages (already localized by the API), keyed by request field name. */
  get fieldErrors(): Record<string, string[]> {
    const fields = this.details.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
    const out: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(fields as Record<string, unknown>)) {
      if (Array.isArray(messages)) out[field] = messages.filter((m): m is string => typeof m === "string");
      else if (typeof messages === "string") out[field] = [messages];
    }
    return out;
  }

  /** ACCOUNT_LOCKED / RATE_LIMITED carry details.retry_after_seconds. */
  get retryAfterSeconds(): number | null {
    const value = this.details.retry_after_seconds;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}

/** Reads the error envelope; anything else (HTML error page, empty body) gets a code from the status. */
export function parseErrorEnvelope(status: number, body: unknown): ApiErrorBody {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
      const e = error as { code: string; message?: unknown; details?: unknown };
      const details = e.details && typeof e.details === "object" && !Array.isArray(e.details) ? e.details : {};
      return {
        code: e.code,
        message: typeof e.message === "string" ? e.message : "",
        details: details as Record<string, unknown>,
      };
    }
  }
  const code = status === 419 ? "CSRF_MISMATCH" : status === 0 ? "NETWORK_ERROR" : `HTTP_${status}`;
  return { code, message: "", details: {} };
}

export type AdminAuthEvent =
  | { type: "unauthenticated"; code: string }
  | { type: "two_factor_setup_required" };

type FetchLike = (request: Request) => Promise<Response>;

export type AdminFetchOptions = {
  /** Underlying fetch (tests inject a mock). */
  fetch?: FetchLike;
  /** Where the XSRF-TOKEN cookie comes from; absolute in tests. */
  csrfUrl?: string;
  getLocale?: () => string;
  getCookie?: (name: string) => string | null;
  onAuthEvent?: (event: AdminAuthEvent) => void;
};

export function readCookie(name: string, cookieString?: string): string | null {
  const source = cookieString ?? (typeof document === "undefined" ? "" : document.cookie);
  for (const part of source.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }
  return null;
}

/** The UI locale: the NEXT_LOCALE cookie, then <html lang>, then Arabic. */
export function currentLocale(): string {
  const fromCookie = readCookie(localeCookie);
  if (isLocale(fromCookie)) return fromCookie;
  const lang = typeof document === "undefined" ? null : document.documentElement.lang;
  return isLocale(lang) ? lang : defaultLocale;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Login, logout and password reset answer 401/422 for their own reasons; they never end a session. */
function isAuthEndpoint(url: string): boolean {
  return /\/v1\/admin\/auth\//.test(url);
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    return parseErrorEnvelope(response.status, body).code;
  } catch {
    return null;
  }
}

export function createAdminFetch(options: AdminFetchOptions = {}): FetchLike {
  const doFetch: FetchLike = options.fetch ?? ((request) => globalThis.fetch(request));
  const csrfUrl = options.csrfUrl ?? CSRF_COOKIE_URL;
  const getLocale = options.getLocale ?? currentLocale;
  const getCookie = options.getCookie ?? ((name: string) => readCookie(name));

  let csrfInFlight: Promise<void> | null = null;

  // Concurrent mutations share one csrf-cookie request.
  function refreshCsrfCookie(): Promise<void> {
    csrfInFlight ??= doFetch(
      new Request(csrfUrl, { method: "GET", credentials: "include", headers: { Accept: "application/json" } }),
    )
      .then(() => undefined)
      .finally(() => {
        csrfInFlight = null;
      });
    return csrfInFlight;
  }

  async function prepare(request: Request): Promise<Request> {
    const headers = new Headers(request.headers);
    headers.set("Accept", "application/json");
    headers.set("Accept-Language", getLocale());
    headers.set("X-Requested-With", "XMLHttpRequest");

    if (!SAFE_METHODS.has(request.method.toUpperCase())) {
      if (getCookie(XSRF_COOKIE) === null) await refreshCsrfCookie();
      const token = getCookie(XSRF_COOKIE);
      if (token !== null) headers.set("X-XSRF-TOKEN", decodeCookieValue(token));
    }

    return new Request(request, { headers, credentials: "include" });
  }

  return async function adminFetch(request: Request): Promise<Response> {
    const mutating = !SAFE_METHODS.has(request.method.toUpperCase());
    // Keep an unread copy of the body for one retry after a stale XSRF token.
    const retryCopy = mutating ? request.clone() : null;

    let response = await doFetch(await prepare(request));

    if (response.status === 419 && retryCopy) {
      await refreshCsrfCookie();
      response = await doFetch(await prepare(retryCopy));
    }

    if (options.onAuthEvent && !isAuthEndpoint(request.url)) {
      if (response.status === 401) {
        options.onAuthEvent({ type: "unauthenticated", code: (await readErrorCode(response)) ?? "UNAUTHENTICATED" });
      } else if (response.status === 403 && (await readErrorCode(response)) === "TWO_FACTOR_SETUP_REQUIRED") {
        options.onAuthEvent({ type: "two_factor_setup_required" });
      }
    }

    return response;
  };
}

let authHandler: ((event: AdminAuthEvent) => void) | null = null;

/** The signed-in area registers one handler (AdminSessionProvider); returns the unregister function. */
export function setAdminAuthHandler(handler: (event: AdminAuthEvent) => void): () => void {
  authHandler = handler;
  return () => {
    if (authHandler === handler) authHandler = null;
  };
}

export function createAdminClient(options: AdminFetchOptions & { baseUrl?: string } = {}) {
  const { baseUrl = ADMIN_API_BASE, ...fetchOptions } = options;
  return createClient<paths>({
    baseUrl,
    credentials: "include",
    headers: { Accept: "application/json" },
    fetch: createAdminFetch({
      ...fetchOptions,
      onAuthEvent: fetchOptions.onAuthEvent ?? ((event) => authHandler?.(event)),
    }),
  });
}

/** The admin client used by every admin screen (browser only: relative to this web origin). */
export const adminApi = createAdminClient();

type ClientResult = { data?: unknown; error?: unknown; response: Response };

/**
 * Awaits an openapi-fetch call and returns its body, or throws AdminApiError (network failures included).
 *
 *   const { data } = await unwrap<DataEnvelope<StaffMe>>(adminApi.GET("/v1/admin/me"));
 */
export async function unwrap<T>(call: Promise<ClientResult>): Promise<T> {
  let result: ClientResult;
  try {
    result = await call;
  } catch (cause) {
    throw AdminApiError.network(cause);
  }
  if (!result.response.ok) {
    throw new AdminApiError(result.response.status, parseErrorEnvelope(result.response.status, result.error));
  }
  return result.data as T;
}
