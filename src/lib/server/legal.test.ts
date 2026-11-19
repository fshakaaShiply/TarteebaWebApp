import { describe, expect, it, vi } from "vitest";
import { getFaq, getLegalPage, isLegalSlug, readFaq, readLang, readLegalPage } from "./legal";
import { readPublicConfig } from "./publicConfig";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the customer web's legal pages and FAQ", () => {
  it("takes only the three slugs, and reads ?lang= as Arabic unless it says English", () => {
    expect(isLegalSlug("terms")).toBe(true);
    expect(isLegalSlug("privacy")).toBe(true);
    expect(isLegalSlug("cancellation")).toBe(true);
    expect(isLegalSlug("../../etc")).toBe(false);
    expect(isLegalSlug(undefined)).toBe(false);
    expect(readLang("en")).toBe("en");
    expect(readLang(["en", "ar"])).toBe("en");
    expect(readLang("fr")).toBe("ar");
    expect(readLang(undefined)).toBe("ar");
  });

  it("reads the page the API publishes and nothing it did not send", () => {
    const page = readLegalPage({ data: { slug: "terms", version_label: "2026-10", effective_date: "2026-10-01", title: "Terms", body: "# Hi", locale: "en", extra: 1 } });
    expect(page).toEqual({ slug: "terms", version_label: "2026-10", effective_date: "2026-10-01", title: "Terms", body: "# Hi" });
    expect(readLegalPage({ data: { title: "", body: "" } })).toBeNull();
    expect(readLegalPage("oops")).toBeNull();
    expect(readFaq({ data: [{ id: 1, question: "Q", answer: "A" }, { id: 2, question: "", answer: "A" }, null, "x"] })).toEqual([{ id: 1, question: "Q", answer: "A" }]);
    expect(readFaq({ data: "nope" })).toBeNull();
  });

  it("asks the API in the page's language, cached for five minutes, and tells a missing page from an unreachable API", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { slug: "privacy", version_label: "2026-10", effective_date: "2026-10-01", title: "Privacy", body: "Text" } }));
    const ok = await getLegalPage("privacy", "en", fetcher);
    expect(ok).toEqual({ status: "ok", data: { slug: "privacy", version_label: "2026-10", effective_date: "2026-10-01", title: "Privacy", body: "Text" } });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/public\/pages\/privacy$/);
    expect(init).toMatchObject({ headers: { "Accept-Language": "en" }, next: { revalidate: 300 } });

    expect(await getLegalPage("terms", "ar", vi.fn().mockResolvedValue(json({ error: { code: "PAGE_NOT_FOUND" } }, 404)))).toEqual({ status: "not_found" });
    expect(await getLegalPage("terms", "ar", vi.fn().mockResolvedValue(json({}, 503)))).toEqual({ status: "unavailable" });
    expect(await getLegalPage("terms", "ar", vi.fn().mockRejectedValue(new Error("down")))).toEqual({ status: "unavailable" });
    expect(await getLegalPage("terms", "ar", vi.fn().mockResolvedValue(json({ data: { title: "", body: "" } })))).toEqual({ status: "unavailable" });
  });

  it("does not call the API for a slug it does not know", async () => {
    const fetcher = vi.fn();
    expect(await getLegalPage("../admin", "ar", fetcher)).toEqual({ status: "not_found" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads the FAQ in the page's language", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: [{ id: 3, question: "Q?", answer: "A." }] }));
    expect(await getFaq("ar", fetcher)).toEqual({ status: "ok", data: [{ id: 3, question: "Q?", answer: "A." }] });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { "Accept-Language": "ar" } });
    expect(String(fetcher.mock.calls[0][0])).toMatch(/\/api\/v1\/public\/faq$/);
  });

  it("reads the cooling-off days the public config publishes", () => {
    expect(readPublicConfig({ data: { support: {}, privacy: { deletion_grace_days: 7 } } })?.deletion_grace_days).toBe(7);
    expect(readPublicConfig({ data: { support: {}, privacy: { deletion_grace_days: "7" } } })?.deletion_grace_days).toBeUndefined();
    expect(readPublicConfig({ data: { support: {} } })?.deletion_grace_days).toBeUndefined();
  });

  it("reads the balance as on only when the public config says exactly so", () => {
    expect(readPublicConfig({ data: { support: {}, wallet: { enabled: true } } })?.wallet_enabled).toBe(true);
    expect(readPublicConfig({ data: { support: {}, wallet: { enabled: false } } })?.wallet_enabled).toBe(false);
    expect(readPublicConfig({ data: { support: {}, wallet: { enabled: "1" } } })?.wallet_enabled).toBe(false);
    expect(readPublicConfig({ data: { support: {} } })?.wallet_enabled).toBe(false);
  });
});
