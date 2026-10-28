import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  BACKGROUND_POLL_HEADER,
  backgroundPoll,
  createAdminClient,
  createAdminFetch,
  parseErrorEnvelope,
  readCookie,
  unwrap,
  type AdminAuthEvent,
} from "./client";

const ORIGIN = "http://web.test";
const CSRF_URL = `${ORIGIN}/backend/sanctum/csrf-cookie`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

type Seen = { url: string; method: string; headers: Headers; body: string };

function recorder(handler: (req: Request, seen: Seen[]) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (req: Request) => {
    const body = req.method === "GET" ? "" : await req.clone().text();
    seen.push({ url: req.url, method: req.method, headers: req.headers, body });
    return handler(req, seen);
  });
  return { fetch, seen };
}

describe("createAdminFetch", () => {
  beforeEach(clearCookies);
  afterEach(clearCookies);

  it("sends Accept-Language and no XSRF header on reads, without fetching the CSRF cookie", async () => {
    const { fetch, seen } = recorder(() => json({ data: {} }));
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "en" });

    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/me`));

    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get("Accept-Language")).toBe("en");
    expect(seen[0].headers.get("Accept")).toBe("application/json");
    expect(seen[0].headers.get("X-Requested-With")).toBe("XMLHttpRequest");
    expect(seen[0].headers.has("X-XSRF-TOKEN")).toBe(false);
  });

  it("fetches the CSRF cookie before the first mutation and sends the decoded token", async () => {
    const { fetch, seen } = recorder((req) => {
      if (req.url === CSRF_URL) {
        document.cookie = "XSRF-TOKEN=abc%3D%3D; path=/";
        return new Response(null, { status: 204 });
      }
      return json({ data: { ok: true } });
    });
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "ar" });

    await adminFetch(
      new Request(`${ORIGIN}/backend/api/v1/admin/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "a@b.c" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(seen.map((s) => s.url)).toEqual([CSRF_URL, `${ORIGIN}/backend/api/v1/admin/auth/login`]);
    expect(seen[1].headers.get("X-XSRF-TOKEN")).toBe("abc==");
    expect(seen[1].headers.get("Accept-Language")).toBe("ar");
    expect(seen[1].body).toBe(JSON.stringify({ email: "a@b.c" }));
  });

  it("reuses an existing XSRF cookie without another csrf-cookie request", async () => {
    document.cookie = "XSRF-TOKEN=tok%2Bone; path=/";
    const { fetch, seen } = recorder(() => json({ data: {} }));
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "ar" });

    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/auth/logout`, { method: "POST" }));

    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get("X-XSRF-TOKEN")).toBe("tok+one");
  });

  it("shares one csrf-cookie request between concurrent mutations", async () => {
    const { fetch, seen } = recorder((req) => {
      if (req.url === CSRF_URL) {
        document.cookie = "XSRF-TOKEN=t1; path=/";
        return new Response(null, { status: 204 });
      }
      return json({ data: {} });
    });
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "ar" });

    await Promise.all([
      adminFetch(new Request(`${ORIGIN}/backend/api/v1/a`, { method: "POST" })),
      adminFetch(new Request(`${ORIGIN}/backend/api/v1/b`, { method: "DELETE" })),
    ]);

    expect(seen.filter((s) => s.url === CSRF_URL)).toHaveLength(1);
  });

  it("refreshes the token and retries once with the same body after a 419", async () => {
    document.cookie = "XSRF-TOKEN=old; path=/";
    let posts = 0;
    const { fetch, seen } = recorder((req) => {
      if (req.url === CSRF_URL) {
        document.cookie = "XSRF-TOKEN=new; path=/";
        return new Response(null, { status: 204 });
      }
      posts += 1;
      return posts === 1 ? json({ message: "CSRF token mismatch." }, 419) : json({ data: { saved: true } });
    });
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "ar" });

    const response = await adminFetch(
      new Request(`${ORIGIN}/backend/api/v1/admin/settings/x`, { method: "PUT", body: '{"value":1}' }),
    );

    expect(response.status).toBe(200);
    const writes = seen.filter((s) => s.url !== CSRF_URL);
    expect(writes.map((s) => s.headers.get("X-XSRF-TOKEN"))).toEqual(["old", "new"]);
    expect(writes[1].body).toBe('{"value":1}');
  });

  it("reports 401 and TWO_FACTOR_SETUP_REQUIRED to the session handler", async () => {
    const events: AdminAuthEvent[] = [];
    const responses = [
      json({ error: { code: "SESSION_EXPIRED", message: "x", details: {} } }, 401),
      json({ error: { code: "TWO_FACTOR_SETUP_REQUIRED", message: "x", details: {} } }, 403),
      json({ error: { code: "FORBIDDEN", message: "x", details: {} } }, 403),
    ];
    const { fetch } = recorder(() => responses.shift()!);
    const adminFetch = createAdminFetch({
      fetch,
      csrfUrl: CSRF_URL,
      getLocale: () => "ar",
      onAuthEvent: (e) => events.push(e),
    });

    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/me`));
    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/settings`));
    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/staff-users`));

    expect(events).toEqual([
      { type: "unauthenticated", code: "SESSION_EXPIRED" },
      { type: "two_factor_setup_required" },
    ]);
  });

  it("sends X-Background-Poll on a timer-driven read only, never on a write", async () => {
    document.cookie = "XSRF-TOKEN=t; path=/";
    const { fetch, seen } = recorder(() => json({ data: {} }));
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "en" });

    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/dashboard/summary`, { headers: backgroundPoll(true) }));
    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/dashboard/summary`, { headers: backgroundPoll(false) }));
    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/alerts/read-all`, { method: "POST", headers: backgroundPoll(true) }));

    expect(seen.map((s) => s.headers.get(BACKGROUND_POLL_HEADER))).toEqual(["1", null, null]);
  });

  it("a background poll answered 401 SESSION_EXPIRED goes to sign-in like any other request", async () => {
    const events: AdminAuthEvent[] = [];
    const { fetch } = recorder(() => json({ error: { code: "SESSION_EXPIRED", message: "x", details: {} } }, 401));
    const client = createAdminClient({ baseUrl: `${ORIGIN}/backend/api`, fetch, getLocale: () => "en", onAuthEvent: (e) => events.push(e) });

    const error = await unwrap(client.GET("/v1/admin/dashboard/alerts", { headers: backgroundPoll(true) })).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 401, code: "SESSION_EXPIRED" });
    expect(events).toEqual([{ type: "unauthenticated", code: "SESSION_EXPIRED" }]);
  });

  it("does not treat sign-in endpoint answers as an ended session", async () => {
    const onAuthEvent = vi.fn();
    document.cookie = "XSRF-TOKEN=t; path=/";
    const { fetch } = recorder(() => json({ error: { code: "UNAUTHENTICATED", message: "", details: {} } }, 401));
    const adminFetch = createAdminFetch({ fetch, csrfUrl: CSRF_URL, getLocale: () => "ar", onAuthEvent });

    await adminFetch(new Request(`${ORIGIN}/backend/api/v1/admin/auth/logout`, { method: "POST" }));

    expect(onAuthEvent).not.toHaveBeenCalled();
  });
});

describe("parseErrorEnvelope", () => {
  it("reads code, message and details", () => {
    expect(
      parseErrorEnvelope(423, {
        error: { code: "ACCOUNT_LOCKED", message: "Locked", details: { retry_after_seconds: 840 } },
      }),
    ).toEqual({ code: "ACCOUNT_LOCKED", message: "Locked", details: { retry_after_seconds: 840 } });
  });

  it("falls back to a status code for non-envelope bodies", () => {
    expect(parseErrorEnvelope(500, "<html>")).toEqual({ code: "HTTP_500", message: "", details: {} });
    expect(parseErrorEnvelope(419, { message: "CSRF token mismatch." }).code).toBe("CSRF_MISMATCH");
    expect(parseErrorEnvelope(422, { error: { code: "X", details: [] } })).toEqual({
      code: "X",
      message: "",
      details: {},
    });
  });
});

describe("AdminApiError", () => {
  it("exposes field errors and retry-after seconds", () => {
    const error = new AdminApiError(422, {
      code: "VALIDATION_FAILED",
      message: "Check the fields",
      details: { fields: { email: ["The email is taken."], roles: "Pick a role." }, retry_after_seconds: 30 },
    });
    expect(error.fieldErrors).toEqual({ email: ["The email is taken."], roles: ["Pick a role."] });
    expect(error.retryAfterSeconds).toBe(30);
    expect(new AdminApiError(500, { code: "HTTP_500", message: "", details: {} }).fieldErrors).toEqual({});
  });
});

describe("createAdminClient + unwrap", () => {
  beforeEach(clearCookies);

  it("returns the data envelope on success", async () => {
    const { fetch, seen } = recorder(() => json({ data: { id: 1, name: "Lina" } }));
    const client = createAdminClient({ baseUrl: `${ORIGIN}/backend/api`, fetch, getLocale: () => "en" });

    const body = await unwrap<{ data: { id: number; name: string } }>(client.GET("/v1/admin/me"));

    expect(body.data.name).toBe("Lina");
    expect(seen[0].url).toBe(`${ORIGIN}/backend/api/v1/admin/me`);
    expect(seen[0].headers.get("Accept-Language")).toBe("en");
  });

  it("throws AdminApiError with the parsed envelope", async () => {
    document.cookie = "XSRF-TOKEN=t; path=/";
    const { fetch } = recorder(() =>
      json({ error: { code: "TWO_FACTOR_REQUIRED", message: "Enter the code", details: {} } }, 422),
    );
    const client = createAdminClient({ baseUrl: `${ORIGIN}/backend/api`, fetch, getLocale: () => "en" });

    const error = await unwrap(
      client.POST("/v1/admin/auth/login", { body: { email: "a@b.c", password: "x" } }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({ status: 422, code: "TWO_FACTOR_REQUIRED", message: "Enter the code" });
  });

  it("turns a failed request into a NETWORK_ERROR", async () => {
    const client = createAdminClient({
      baseUrl: `${ORIGIN}/backend/api`,
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
      getLocale: () => "ar",
    });

    await expect(unwrap(client.GET("/v1/admin/me"))).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});

describe("readCookie", () => {
  it("finds a cookie by exact name", () => {
    expect(readCookie("XSRF-TOKEN", "a=1; XSRF-TOKEN=x%3D; XSRF-TOKEN2=y")).toBe("x%3D");
    expect(readCookie("missing", "a=1")).toBeNull();
  });
});
