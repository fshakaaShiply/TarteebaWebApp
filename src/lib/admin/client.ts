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
 *   - 401 and 403 TWO_FACTOR_SETUP_REQUIRED are reported to the session (lib/admin/session.tsx), which redirects;
 *   - a timer-driven read sends X-Background-Poll: 1 (backgroundPoll()): the API checks the idle timeout as usual (401
 *     SESSION_EXPIRED goes to sign-in like any other 401) but does not count the read as staff activity (spec §13.2).
 *     Only GET and HEAD may carry it (the API ignores it on writes, which always count); it is dropped from any other.
 */

export const ADMIN_API_BASE = "/backend/api";
export const CSRF_COOKIE_URL = "/backend/sanctum/csrf-cookie";
export const XSRF_COOKIE = "XSRF-TOKEN";
export const BACKGROUND_POLL_HEADER = "X-Background-Poll";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const POLL_METHODS = new Set(["GET", "HEAD"]);

/** Whether a read was started by a timer (a background poll) rather than by the user. */
export type ReadOptions = { background?: boolean };

/**
 * The per-call headers of a read: X-Background-Poll: 1 for a timer-driven one, nothing for a load the user started
 * (opening a page, changing a filter, Refresh), which counts as activity.
 *
 *   adminApi.GET("/v1/admin/dashboard/summary", { params, headers: backgroundPoll(opts.background) })
 */
export function backgroundPoll(background: boolean | undefined): Record<string, string> {
  return background ? { [BACKGROUND_POLL_HEADER]: "1" } : {};
}

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
    if (!POLL_METHODS.has(request.method.toUpperCase())) headers.delete(BACKGROUND_POLL_HEADER);

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

export type AdminUploadOptions = {
  /** POST by default; a replacement of one file may be a PUT. */
  method?: "POST" | "PUT" | "PATCH";
  /** Cancels the upload (the file picker's "Remove" while it is still sending). */
  signal?: AbortSignal;
  /** Extra headers such as `If-Match` or `Idempotency-Key`. Never a Content-Type: the browser sets the multipart boundary. */
  headers?: Record<string, string>;
};

/**
 * Sends a multipart form (files and fields) to an admin endpoint through the same fetch as every other admin call:
 * CSRF cookie and X-XSRF-TOKEN, Accept-Language, one retry after a 419, 401/2FA reported to the session. Resolves with the
 * parsed JSON answer (null for an empty one) and throws AdminApiError like `unwrap` (network failures included).
 * `path` is the API path after /api, for example "/v1/admin/workers/12/documents". The proxy streams the body, so the
 * file is never buffered by the web server. Progress is not reported: fetch has no upload progress, so callers show a
 * busy state until the answer.
 *
 *   const form = new FormData();
 *   form.append("file", file);
 *   const document = await adminUpload<DataEnvelope<WorkerDocument>>("/v1/admin/workers/12/documents", form);
 */
export function createAdminUpload(options: AdminFetchOptions & { baseUrl?: string } = {}) {
  const { baseUrl = ADMIN_API_BASE, ...fetchOptions } = options;
  const adminFetch = createAdminFetch({
    ...fetchOptions,
    onAuthEvent: fetchOptions.onAuthEvent ?? ((event) => authHandler?.(event)),
  });
  return async function adminUpload<T>(path: string, body: FormData, uploadOptions: AdminUploadOptions = {}): Promise<T> {
    if (!path.startsWith("/")) throw new Error("adminUpload: the path starts with a slash.");
    let response: Response;
    try {
      const headers = new Headers(uploadOptions.headers);
      headers.delete("Content-Type");
      response = await adminFetch(
        new Request(`${baseUrl}${path}`, { method: uploadOptions.method ?? "POST", body, headers, signal: uploadOptions.signal }),
      );
    } catch (cause) {
      // A cancelled upload is the caller's own doing, not a network failure.
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw AdminApiError.network(cause);
    }
    let parsed: unknown = null;
    try {
      const text = await response.text();
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!response.ok) throw new AdminApiError(response.status, parseErrorEnvelope(response.status, parsed));
    return parsed as T;
  };
}

/** The admin upload helper used by every screen with a file field (browser only: relative to this web origin). */
export const adminUpload = createAdminUpload();
