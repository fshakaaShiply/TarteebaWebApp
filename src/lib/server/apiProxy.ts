import { isIP } from "node:net";

/*
 * Same-origin API proxy for the admin panel (src/app/backend/[...path]/route.ts). The browser calls
 * /backend/api/... and /backend/sanctum/csrf-cookie on this web origin, so the Sanctum session and XSRF cookies are
 * first-party; this module forwards those requests to API_INTERNAL_URL at request time.
 *
 *   - only api/* and sanctum/csrf-cookie are forwarded (never /up, Horizon, webhooks or anything else);
 *   - request: method, streamed body, cookies and the headers the admin client sends; X-Forwarded-For carries the
 *     admin's own address (not this server's), X-Forwarded-Host/Proto/Port describe the web origin;
 *   - response: status, body (streamed) and headers, every Set-Cookie unchanged.
 *
 * The API resolves the client address from X-Forwarded-For through its trusted proxies (bootstrap/app.php), so the
 * hop between this server and the API must be one the API trusts (see CLAUDE.md, "API proxy").
 */

/** Local API when API_INTERNAL_URL is unset outside production (`pnpm dev`). */
export const DEV_API_ORIGIN = "http://localhost:8000";
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * The API origin from API_INTERNAL_URL (scheme + host + port, no path). Production refuses to guess: a missing or
 * malformed value throws, so the server fails at start (src/instrumentation.ts) instead of proxying to localhost.
 */
export function apiOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.API_INTERNAL_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production") {
      throw new Error("API_INTERNAL_URL is not set: the admin /backend proxy needs the API origin (e.g. https://tarteeba-api.shiplytechnologies.com).");
    }
    return DEV_API_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`API_INTERNAL_URL is not a URL: ${raw}`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname.replace(/\/+$/, "") !== "" || url.search || url.hash) {
    throw new Error(`API_INTERNAL_URL must be an http(s) origin without a path: ${raw}`);
  }
  return url.origin;
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Server start (src/instrumentation.ts): a production server without a usable API_INTERNAL_URL exits instead of
 * serving an admin panel whose every API call fails. Next.js only logs an error thrown from register() and keeps
 * running, so this exits explicitly; PM2 then reports the app as errored and the deploy check fails.
 */
export function assertApiOriginAtStartup(env: Record<string, string | undefined> = process.env): void {
  try {
    apiOrigin(env);
  } catch (error) {
    console.error(`[startup] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * The API path for a /backend/... request path, or null when it is not proxied. Only /backend/api/<something> and
 * /backend/sanctum/csrf-cookie pass; encoded slashes, dot segments, empty segments and control characters are refused
 * so no path can be steered to another API route (e.g. /backend/api/..%2Fup).
 */
export function upstreamPath(pathname: string): string | null {
  const prefix = "/backend/";
  if (!pathname.startsWith(prefix)) return null;
  const segments = pathname.slice(prefix.length).split("/");
  for (const segment of segments) {
    if (segment === "") return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === "." || decoded === ".." || /[/\\]/.test(decoded) || hasControlCharacter(decoded)) return null;
  }
  const path = `/${segments.join("/")}`;
  if (path === "/sanctum/csrf-cookie") return path;
  if (segments[0] === "api" && segments.length >= 2) return path;
  return null;
}

function validIp(value: string | null | undefined): string | null {
  const ip = value?.trim();
  return ip && isIP(ip) ? ip : null;
}

/**
 * The admin's address as this server received it: Cloudflare's CF-Connecting-IP (Cloudflare overwrites any value the
 * browser sends), then X-Real-IP, then the last X-Forwarded-For entry, which is the peer the nearest proxy (Nginx, or
 * Next.js itself without a proxy) saw. Earlier X-Forwarded-For entries are client-supplied and ignored.
 */
export function clientAddress(headers: Headers): string | null {
  const cloudflare = validIp(headers.get("cf-connecting-ip"));
  if (cloudflare) return cloudflare;
  const real = validIp(headers.get("x-real-ip"));
  if (real) return real;
  const chain = headers.get("x-forwarded-for")?.split(",") ?? [];
  return validIp(chain[chain.length - 1]);
}

/**
 * Headers the admin client sends that the API needs (cookies, CSRF, language, versioning, Sanctum's origin check, and
 * the Idempotency-Key of the routes that move money or capacity, spec §4.5).
 */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "content-length",
  "cookie",
  "idempotency-key",
  "if-match",
  "if-none-match",
  "origin",
  "referer",
  "user-agent",
  "x-request-id",
  "x-requested-with",
  "x-xsrf-token",
] as const;

/**
 * Headers for the API request. X-Forwarded-For is replaced by the admin's address alone, so the API (which takes the
 * last untrusted entry) cannot pick up a client-supplied entry. X-Forwarded-Host/Proto/Port describe the web origin
 * from the Host header (Nginx sets it), never from a client-supplied X-Forwarded-Host.
 */
export function upstreamRequestHeaders(incoming: Headers, requestUrl: URL): Headers {
  const out = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value !== null) out.set(name, value);
  }
  const ip = clientAddress(incoming);
  if (ip) out.set("x-forwarded-for", ip);

  const host = incoming.get("host") ?? requestUrl.host;
  const forwardedProto = incoming.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : requestUrl.protocol.replace(/:$/, "");
  const explicitPort = /:(\d+)$/.exec(host)?.[1];
  out.set("x-forwarded-host", host);
  out.set("x-forwarded-proto", proto);
  out.set("x-forwarded-port", explicitPort ?? (proto === "https" ? "443" : "80"));
  return out;
}

/**
 * Hop-by-hop headers, plus content-encoding/-length: fetch() has already decoded the body, so the original values no
 * longer describe it. Set-Cookie is copied separately so several cookies stay separate headers.
 */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

export function downstreamResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) out.append(name, value);
  });
  for (const cookie of upstream.getSetCookie()) out.append("set-cookie", cookie);
  return out;
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ error: { code, message: "", details: {} } }, { status, headers: { "cache-control": "no-store" } });
}

type FetchLike = (input: string, init: RequestInit & { duplex?: "half" }) => Promise<Response>;

/** Forwards one /backend/... request to the API and streams the answer back. */
export async function proxyToApi(
  request: Request,
  options: { fetch?: FetchLike; env?: Record<string, string | undefined> } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = upstreamPath(url.pathname);
  if (path === null) return errorResponse(404, "NOT_FOUND");

  let origin: string;
  try {
    origin = apiOrigin(options.env);
  } catch (error) {
    console.error("[backend proxy]", error instanceof Error ? error.message : error);
    return errorResponse(503, "PROXY_NOT_CONFIGURED");
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && request.body !== null;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const signals = [AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), ...(request.signal ? [request.signal] : [])];

  let upstream: Response;
  try {
    upstream = await doFetch(`${origin}${path}${url.search}`, {
      method,
      headers: upstreamRequestHeaders(request.headers, url),
      body: hasBody ? request.body : undefined,
      // Streams the request body instead of buffering it (Node fetch requires half duplex for a stream body).
      ...(hasBody ? { duplex: "half" as const } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any(signals),
    });
  } catch (error) {
    console.error(`[backend proxy] ${method} ${path} failed:`, error instanceof Error ? error.message : error);
    return errorResponse(502, "BAD_GATEWAY");
  }

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: downstreamResponseHeaders(upstream.headers),
  });
}
