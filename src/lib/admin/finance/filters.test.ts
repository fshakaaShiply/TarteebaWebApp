import { describe, expect, it } from "vitest";
import {
  INVOICE_FILTERS,
  PAYMENT_FILTERS,
  REFUND_FILTERS,
  dateRangeValid,
  emptyFilters,
  filterKey,
  filtersFromParams,
  filtersToParams,
  hasFilters,
  phoneSearchValid,
} from "./filters";

describe("A09 list filters in the URL", () => {
  it("reads the API's own parameter names and drops anything malformed", () => {
    const params = new URLSearchParams("status=captured&from=2026-10-01&to=2026-02-30&payable_type=boat&needs_review=1&phone=0501&page=3");
    expect(filtersFromParams(PAYMENT_FILTERS, params)).toEqual({
      status: "captured",
      from: "2026-10-01",
      to: "",
      phone: "0501",
      payable_type: "",
      needs_review: "1",
      reference: "",
      page: 3,
    });
    expect(filtersFromParams(REFUND_FILTERS, new URLSearchParams("reason_code=price_difference&payment_id=0&status=bogus"))).toMatchObject({
      reason_code: "price_difference",
      payment_id: "",
      status: "",
    });
    expect(filtersFromParams(INVOICE_FILTERS, new URLSearchParams("payment_id=9")).payment_id).toBe("9");
  });

  it("takes any refund reason shaped like an API code, since the API lists the reasons", () => {
    const reason = (raw: string) => filtersFromParams(REFUND_FILTERS, new URLSearchParams({ reason_code: raw })).reason_code;
    // A reason added on the API side is filterable without a web release.
    expect(reason("loyalty_credit")).toBe("loyalty_credit");
    expect(reason("Goodwill")).toBe("");
    expect(reason("a")).toBe("");
    expect(reason("x".repeat(41))).toBe("");
    expect(reason("goodwill;drop")).toBe("");
  });

  it("writes only what is set, page 1 implied", () => {
    const filters = { ...emptyFilters(PAYMENT_FILTERS), status: "refunded", reference: "  ", page: 1 };
    expect(filtersToParams(PAYMENT_FILTERS, filters).toString()).toBe("status=refunded");
    expect(filtersToParams(PAYMENT_FILTERS, { ...filters, page: 2 }).toString()).toBe("status=refunded&page=2");
    expect(hasFilters(PAYMENT_FILTERS, emptyFilters(PAYMENT_FILTERS))).toBe(false);
    expect(hasFilters(PAYMENT_FILTERS, filters)).toBe(true);
  });

  it("keys a list by its filters, with the debounced text in place of what is being typed", () => {
    const filters = { ...emptyFilters(PAYMENT_FILTERS), phone: "05012", status: "captured", page: 2 };
    expect(filterKey(PAYMENT_FILTERS, filters, { phone: "0501", reference: "" })).toMatchObject({ phone: "0501", status: "captured", page: 2 });
  });

  it("checks the date range and the phone search the way the API does", () => {
    expect(dateRangeValid({ from: "2026-10-05", to: "2026-10-01" })).toBe(false);
    expect(dateRangeValid({ from: "2026-10-01", to: "" })).toBe(true);
    expect(phoneSearchValid("")).toBe(true);
    expect(phoneSearchValid("+971 50")).toBe(true);
    expect(phoneSearchValid("050")).toBe(false);
    expect(phoneSearchValid("0000123")).toBe(false);
    expect(phoneSearchValid("sara")).toBe(false);
  });
});
