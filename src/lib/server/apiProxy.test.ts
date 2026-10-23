// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, assertApiOriginAtStartup, clientAddress, proxyToApi, upstreamPath, upstreamRequestHeaders } from "./apiProxy";

const ENV = { API_INTERNAL_URL: "https://api.example.test", NODE_ENV: "production" };

afterEach(() => {
  vi.restoreAllMocks();
});

type Captured = { url: string; init: RequestInit & { duplex?: string } };

function fakeApi(response: () => Response) {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit & { duplex?: "half" }) => {
    calls.push({ url, init });
    return response();
  });
  return { fetch, calls };
}

// What Next.js hands the Route Handler on staging: Nginx sets Host and appends Cloudflare's edge to X-Forwarded-For;
// Cloudflare adds CF-Connecting-IP. The browser tried to spoof X-Forwarded-For and X-Forwarded-Host.
const stagingHeaders = {
  host: "tarteeba.shiplytechnologies.com",
  "x-forwarded-for": "6.6.6.6, 203.0.113.7, 172.70.1.2",
  "x-forwarded-proto": "https",
  "x-forwarded-host": "evil.example",
  "x-forwarded-port": "3000",
  "cf-connecting-ip": "203.0.113.7",
  accept: "application/json",
  "accept-language": "ar",
  "content-type": "application/json",
  cookie: "tarteeba_session=abc; XSRF-TOKEN=tok",
  "x-xsrf-token": "tok",
  "x-requested-with": "XMLHttpRequest",
  "if-match": "3",
  origin: "https://tarteeba.shiplytechnologies.com",
  referer: "https://tarteeba.shiplytechnologies.com/admin/catalog/services/1",
  "user-agent": "Mozilla/5.0 Test",
  authorization: "Bearer should-not-pass",
};

describe("/backend proxy: which paths reach the API", () => {
  it.each([
    ["/backend/api/v1/admin/me", "/api/v1/admin/me"],
    ["/backend/api/v1/admin/catalog/services/1", "/api/v1/admin/catalog/services/1"],
    ["/backend/sanctum/csrf-cookie", "/sanctum/csrf-cookie"],
  ])("forwards %s", (path, upstream) => {
    expect(upstreamPath(path)).toBe(upstream);
  });

  it.each([
    "/backend/up",
    "/backend/horizon",
    "/backend/horizon/api/stats",
    "/backend/api",
    "/backend/sanctum/csrf-cookie/x",
    "/backend/webhooks/payments",
    "/backend/api/..%2Fup",
    "/backend/api/%2e%2e/up",
    "/backend/api/v1%2F..%2F..%2Fhorizon",
    "/backend/api/v1/%5C..%5Cup",
    "/backend/api//v1/admin/me",
    "/backend/api/v1/%00",
    "/backend/api/v1/%E0%A4%A",
    "/api/v1/admin/me",
  ])("refuses %s", (path) => {
    expect(upstreamPath(path)).toBeNull();
  });

  it("answers 404 without calling the API for a path outside the allow-list", async () => {
    const api = fakeApi(() => new Response("{}"));
    const response = await proxyToApi(new Request("https://tarteeba.shiplytechnologies.com/backend/horizon"), { fetch: api.fetch, env: ENV });
    expect(response.status).toBe(404);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe("/backend proxy: request to the API", () => {
  it("takes the admin's address from CF-Connecting-IP, then X-Real-IP, then the last X-Forwarded-For hop", () => {
    expect(clientAddress(new Headers(stagingHeaders))).toBe("203.0.113.7");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("198.51.100.4");
    expect(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" }))).toBe("198.51.100.9");
    expect(clientAddress(new Headers({ "x-forwarded-for": "::1" }))).toBe("::1");
    expect(clientAddress(new Headers({ "cf-connecting-ip": "not-an-ip", "x-forwarded-for": "garbage" }))).toBeNull();
  });

  it("forwards the admin client's headers, the client address and the web origin, nothing else", () => {
    const headers = upstreamRequestHeaders(new Headers(stagingHeaders), new URL("http://127.0.0.1:3000/backend/api/v1/admin/me"));
    expect(Object.fromEntries(headers)).toEqual({
      accept: "application/json",
      "accept-language": "ar",
      "content-type": "application/json",
      cookie: "tarteeba_session=abc; XSRF-TOKEN=tok",
      "if-match": "3",
      origin: "https://tarteeba.shiplytechnologies.com",
      referer: "https://tarteeba.shiplytechnologies.com/admin/catalog/services/1",
      "user-agent": "Mozilla/5.0 Test",
      "x-requested-with": "XMLHttpRequest",
      "x-xsrf-token": "tok",
      "x-forwarded-for": "203.0.113.7",
      "x-forwarded-host": "tarteeba.shiplytechnologies.com",
      "x-forwarded-proto": "https",
      "x-forwarded-port": "443",
    });
  });

  it("forwards the Idempotency-Key of a money route (confirm, cancel, manual booking …)", () => {
    const headers = upstreamRequestHeaders(
      new Headers({ ...stagingHeaders, "idempotency-key": "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f" }),
      new URL("https://tarteeba.shiplytechnologies.com/backend/api/v1/admin/bookings/12/confirm"),
    );
    expect(headers.get("idempotency-key")).toBe("3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
  });

  it("describes a local dev origin with its port", () => {
    const headers = upstreamRequestHeaders(
      new Headers({ host: "localhost:3000", "x-forwarded-for": "::1" }),
      new URL("http://localhost:3000/backend/api/v1/admin/me"),
    );
    expect(headers.get("x-forwarded-host")).toBe("localhost:3000");
    expect(headers.get("x-forwarded-proto")).toBe("http");
    expect(headers.get("x-forwarded-port")).toBe("3000");
    expect(headers.get("x-forwarded-for")).toBe("::1");
  });

  it("streams a PATCH with its body, query string and If-Match to API_INTERNAL_URL", async () => {
    const api = fakeApi(() => Response.json({ data: { id: 1 } }));
    const body = JSON.stringify({ name: { ar: "زيارة", en: "Visit" }, reason: "x" });
    const request = new Request("https://tarteeba.shiplytechnologies.com/backend/api/v1/admin/catalog/services/1?include=prices", {
      method: "PATCH",
      headers: { ...stagingHeaders, "content-length": String(Buffer.byteLength(body)) },
      body,
    });
    const response = await proxyToApi(request, { fetch: api.fetch, env: ENV });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 1 } });
    const [{ url, init }] = api.calls;
    expect(url).toBe("https://api.example.test/api/v1/admin/catalog/services/1?include=prices");
    expect(init.method).toBe("PATCH");
    expect(init.duplex).toBe("half");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(init.body).text()).toBe(body);
    const sent = new Headers(init.headers);
    expect(sent.get("if-match")).toBe("3");
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(sent.get("content-length")).toBe(String(Buffer.byteLength(body)));
    expect(sent.has("authorization")).toBe(false);
  });

  it("sends GET without a body", async () => {
    const api = fakeApi(() => new Response(null, { status: 204 }));
    const response = await proxyToApi(new Request("http://localhost:3000/backend/sanctum/csrf-cookie", { headers: { host: "localhost:3000" } }), {
      fetch: api.fetch,
      env: {},
    });
    expect(response.status).toBe(204);
    expect(api.calls[0].url).toBe("http://localhost:8000/sanctum/csrf-cookie");
    expect(api.calls[0].init.body).toBeUndefined();
    expect(api.calls[0].init).not.toHaveProperty("duplex");
  });
});

describe("/backend proxy: response from the API", () => {
  it("passes every Set-Cookie back unchanged and drops encoding and hop-by-hop headers", async () => {
    const api = fakeApi(() => {
      const headers = new Headers({ "content-type": "application/json", "content-encoding": "gzip", connection: "keep-alive", vary: "Accept-Language" });
      headers.append("set-cookie", "XSRF-TOKEN=eyJ; expires=Wed, 21 Oct 2026 20:00:00 GMT; Max-Age=7200; path=/; samesite=lax");
      headers.append("set-cookie", "tarteeba_session=eyK; expires=Wed, 21 Oct 2026 20:00:00 GMT; Max-Age=7200; path=/; httponly; samesite=lax");
      return new Response('{"data":null}', { status: 200, headers });
    });
    const response = await proxyToApi(new Request("https://tarteeba.shiplytechnologies.com/backend/sanctum/csrf-cookie"), { fetch: api.fetch, env: ENV });

    expect(response.headers.getSetCookie()).toEqual([
      "XSRF-TOKEN=eyJ; expires=Wed, 21 Oct 2026 20:00:00 GMT; Max-Age=7200; path=/; samesite=lax",
      "tarteeba_session=eyK; expires=Wed, 21 Oct 2026 20:00:00 GMT; Max-Age=7200; path=/; httponly; samesite=lax",
    ]);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("vary")).toBe("Accept-Language");
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("connection")).toBe(false);
  });

  it("keeps the API's status and error body", async () => {
    const api = fakeApi(() => Response.json({ error: { code: "STALE_VERSION", message: "", details: {} } }, { status: 409 }));
    const response = await proxyToApi(new Request("https://x.test/backend/api/v1/admin/settings/vat.rate_percent", { method: "PUT", body: "{}" }), {
      fetch: api.fetch,
      env: ENV,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "STALE_VERSION", message: "", details: {} } });
  });

  it("answers 502 in the API error envelope when the API cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const response = await proxyToApi(new Request("https://x.test/backend/api/v1/admin/me"), { fetch, env: ENV });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "BAD_GATEWAY", message: "", details: {} } });
  });
});

describe("API_INTERNAL_URL", () => {
  it("is required in production and must be an origin", () => {
    expect(() => apiOrigin({ NODE_ENV: "production" })).toThrow(/API_INTERNAL_URL is not set/);
    expect(() => apiOrigin({ NODE_ENV: "production", API_INTERNAL_URL: " " })).toThrow(/not set/);
    expect(() => apiOrigin({ API_INTERNAL_URL: "https://api.example.test/api" })).toThrow(/without a path/);
    expect(() => apiOrigin({ API_INTERNAL_URL: "ftp://api.example.test" })).toThrow(/http\(s\) origin/);
    expect(() => apiOrigin({ API_INTERNAL_URL: "api.example.test" })).toThrow(/not a URL/);
    expect(apiOrigin({ NODE_ENV: "production", API_INTERNAL_URL: "https://api.example.test/" })).toBe("https://api.example.test");
    expect(apiOrigin({ NODE_ENV: "development" })).toBe("http://localhost:8000");
  });

  it("stops a production server at start when it is missing", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    assertApiOriginAtStartup({ NODE_ENV: "production" });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0][0]).toMatch(/API_INTERNAL_URL is not set/);
    exit.mockClear();
    assertApiOriginAtStartup({ NODE_ENV: "production", API_INTERNAL_URL: "https://api.example.test" });
    assertApiOriginAtStartup({ NODE_ENV: "development" });
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("is not guessed by a production server: the proxy answers 503 instead of calling localhost", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = fakeApi(() => new Response("{}"));
    const response = await proxyToApi(new Request("https://x.test/backend/api/v1/admin/me"), { fetch: api.fetch, env: { NODE_ENV: "production" } });
    expect(response.status).toBe(503);
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
