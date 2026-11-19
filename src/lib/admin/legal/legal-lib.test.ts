import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "../client";
import { describeLegalError } from "./errors";
import { checkEffectiveDate, checkFaq, checkPage, checkVersionLabel, moveId, quotesFigures, unknownPlaceholders } from "./forms";

describe("legal page checks", () => {
  it("accepts the version labels the API accepts and refuses the rest", () => {
    expect(checkVersionLabel("2026-10")).toBeNull();
    expect(checkVersionLabel("v1.2_rc")).toBeNull();
    expect(checkVersionLabel("")).toBe("required");
    expect(checkVersionLabel("-2026")).toBe("invalid");
    expect(checkVersionLabel("2026 10")).toBe("invalid");
    expect(checkVersionLabel("x".repeat(21))).toBe("tooLong");
    expect(checkEffectiveDate("")).toBe("required");
    expect(checkEffectiveDate("2026-13-40")).toBe("invalid");
    expect(checkEffectiveDate("2026-11-01")).toBeNull();
  });

  it("needs both languages of the title and the text, each within its limit", () => {
    const ok = { version_label: "2026-11", effective_date: "2026-11-01", title: { ar: "عنوان", en: "Title" }, body: { ar: "نص", en: "Text" } };
    expect(checkPage(ok)).toEqual({ ok: true });
    const result = checkPage({ ...ok, title: { ar: "", en: "T".repeat(121) }, body: { ar: "  ", en: "x" } });
    expect(result).toEqual({ ok: false, errors: { title: { ar: "required", en: "tooLong" }, body: { ar: "required", en: null } } });
  });

  it("sees a percentage on the cancellation page in either language and in Arabic digits, and nowhere else", () => {
    const none = { ar: "", en: "" };
    expect(quotesFigures("cancellation", none, { ar: "", en: "A 50% fee applies" })).toBe(true);
    expect(quotesFigures("cancellation", none, { ar: "رسوم ٥٠٪ تطبق", en: "" })).toBe(true);
    expect(quotesFigures("cancellation", { ar: "", en: "100 %" }, none)).toBe(true);
    expect(quotesFigures("cancellation", none, { ar: "تظهر الرسوم قبل التأكيد", en: "Fees are shown before you confirm" })).toBe(false);
    expect(quotesFigures("terms", none, { ar: "", en: "A 50% fee applies" })).toBe(false);
  });
});

describe("FAQ checks", () => {
  it("finds a {{placeholder}} the API cannot fill in", () => {
    expect(unknownPlaceholders("Within {{confirmation_sla}}, refunds {{ refund_estimated_arrival }}")).toEqual([]);
    expect(unknownPlaceholders("Hello {{name}} and {{name}} and {{other}}")).toEqual(["name", "other"]);
    expect(unknownPlaceholders("plain text")).toEqual([]);
  });

  it("needs both languages, and names the first unknown placeholder", () => {
    const item = { question: { ar: "س", en: "Q" }, answer: { ar: "ج", en: "A" }, is_active: true };
    expect(checkFaq(item)).toEqual({ ok: true });
    expect(checkFaq({ ...item, question: { ar: "", en: "Q" } })).toEqual({ ok: false, errors: { question: { ar: "required", en: null } } });
    expect(checkFaq({ ...item, answer: { ar: "ج {{who}}", en: "A" } })).toEqual({ ok: false, errors: { placeholder: "who" } });
    expect(checkFaq({ ...item, answer: { ar: "ج", en: "x".repeat(2001) } })).toMatchObject({ ok: false, errors: { answer: { en: "tooLong" } } });
  });

  it("moves an item one place and leaves the order at the ends", () => {
    expect(moveId([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe("content error words", () => {
  const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);
  const error = (code: string, details: Record<string, unknown> = {}) => new AdminApiError(422, { code, message: "api words", details });

  it("puts the label, the placeholder and the limit the API names in", () => {
    expect(describeLegalError(error("VERSION_LABEL_TAKEN", { version_label: "2026-10" }), t, () => "shared")).toBe('VERSION_LABEL_TAKEN:{"label":"2026-10"}');
    expect(describeLegalError(error("VERSION_LABEL_TAKEN"), t, () => "shared")).toBe("VERSION_LABEL_TAKEN_plain");
    expect(describeLegalError(error("PLACEHOLDER_UNKNOWN", { placeholder: "{{x}}", allowed: [] }), t, () => "shared")).toBe('PLACEHOLDER_UNKNOWN:{"placeholder":"{{x}}"}');
    expect(describeLegalError(error("FAQ_LIMIT_REACHED", { max: 100 }), t, () => "shared")).toBe('FAQ_LIMIT_REACHED:{"max":100}');
    expect(describeLegalError(error("PAGE_NOT_EDITABLE"), t, () => "shared")).toBe("PAGE_NOT_EDITABLE");
    expect(describeLegalError(error("STALE_VERSION"), t, () => "shared")).toBe("shared");
  });
});

const calls = vi.hoisted(() => ({ list: [] as { method: string; path: string; options: Record<string, unknown> }[] }));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  const record = (method: string) =>
    vi.fn(async (path: string, options: Record<string, unknown> = {}) => {
      calls.list.push({ method, path, options });
      return { data: { data: [] }, response: new Response(null, { status: 200 }) };
    });
  return { ...actual, adminApi: { GET: record("GET"), POST: record("POST"), PATCH: record("PATCH"), PUT: record("PUT"), DELETE: record("DELETE") } };
});

describe("A11 content endpoints", () => {
  beforeEach(() => {
    calls.list = [];
  });
  const last = () => calls.list[calls.list.length - 1];

  it("reads the pages, saves a draft with its version as If-Match and publishes with a reason", async () => {
    const { fetchPages, createPage, updatePage, publishPage, deletePage } = await import("./endpoints");
    await fetchPages("terms");
    expect(last()).toMatchObject({ method: "GET", path: "/v1/admin/pages", options: { params: { query: { slug: "terms" } } } });
    await fetchPages();
    expect(last().options).toMatchObject({ params: { query: {} } });
    await createPage({ slug: "privacy", version_label: " 2026-11 ", effective_date: "2026-11-01", title: { ar: "ع", en: "T" }, body: { ar: "ن", en: "B" } });
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/pages", options: { body: { slug: "privacy", version_label: "2026-11" } } });
    await updatePage(7, { title: { ar: "ع", en: "T2" } }, 3);
    expect(last()).toMatchObject({ method: "PATCH", path: "/v1/admin/pages/{page}", options: { params: { path: { page: 7 } }, body: { title: { ar: "ع", en: "T2" } }, headers: { "If-Match": "3" } } });
    await publishPage(7, " New terms ", 4);
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/pages/{page}/publish", options: { body: { reason: "New terms" }, headers: { "If-Match": "4" } } });
    await deletePage(7, 4);
    expect(last()).toMatchObject({ method: "DELETE", path: "/v1/admin/pages/{page}", options: { headers: { "If-Match": "4" } } });
  });

  it("works the FAQ: add, change with the version, delete, and send the whole order", async () => {
    const { createFaq, updateFaq, deleteFaq, reorderFaq } = await import("./endpoints");
    await createFaq({ question: { ar: "س", en: "Q" }, answer: { ar: "ج", en: "A" }, is_active: true });
    expect(last()).toMatchObject({ method: "POST", path: "/v1/admin/faq" });
    await updateFaq(4, { is_active: false }, 2);
    expect(last()).toMatchObject({ method: "PATCH", path: "/v1/admin/faq/{item}", options: { params: { path: { item: 4 } }, body: { is_active: false }, headers: { "If-Match": "2" } } });
    await deleteFaq(4);
    expect(last()).toMatchObject({ method: "DELETE", path: "/v1/admin/faq/{item}" });
    await reorderFaq([3, 1, 2]);
    expect(last()).toMatchObject({ method: "PUT", path: "/v1/admin/faq/order", options: { body: { ids: [3, 1, 2] } } });
  });
});
