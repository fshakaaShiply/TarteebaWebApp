import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { formatAed } from "@/lib/money";
import { AdminApiError } from "../client";
import { FINANCE_ERROR_CODES, describeFinanceError } from "./errors";

const error = (code: string, details: Record<string, unknown> = {}, status = 409) => new AdminApiError(status, { code, message: "API words", details });

function describeIn(locale: "ar" | "en", e: unknown) {
  const messages = locale === "ar" ? ar : en;
  const t = createTranslator({ locale, messages, namespace: "admin.finance.errors" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const shared = createTranslator({ locale, messages, namespace: "admin.errors" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  return describeFinanceError(e, t, (fils) => formatAed(fils, locale, { fixed: true }), (x) => (x instanceof AdminApiError ? `shared:${x.code}` : shared("generic")));
}

describe("the finance error codes in our words", () => {
  it("answers every code in both languages, never with the API's own text", () => {
    for (const code of FINANCE_ERROR_CODES) {
      for (const locale of ["en", "ar"] as const) {
        const text = describeIn(locale, error(code));
        expect(text, `${locale} ${code}`).not.toMatch(/^admin\.finance\.errors/);
        expect(text, `${locale} ${code}`).not.toBe("API words");
        expect(text.length).toBeGreaterThan(5);
      }
    }
  });

  it("puts the figures the API names in", () => {
    expect(describeIn("en", error("REFUND_AMOUNT_INVALID", { refundable_fils: 6000 }, 422))).toBe("At most AED 60.00 can be refunded.");
    expect(describeIn("ar", error("REFUND_AMOUNT_INVALID", { refundable_fils: 6000 }, 422))).toContain("60.00");
    expect(describeIn("en", error("WALLET_BALANCE_INSUFFICIENT", { balance_fils: 1000, amount_fils: 24000 }, 422))).toBe("The balance is only AED 10.00. Enter an amount up to the balance.");
    expect(describeIn("en", error("TERMS_CHANGED", { amount_fils: 13000 }))).toMatch(/new amount/);
    expect(describeIn("en", error("OPEN_REFUND_EXISTS", { refund: { id: 1, ulid: "x", amount_fils: 6000, status: "processing" } }))).toBe(
      "This payment already has a refund open (AED 60.00, processing). Wait for the provider's answer first.",
    );
    expect(describeIn("en", error("SETTLEMENT_FILE_TOO_LARGE", { max_bytes: 10485760, max_lines: 50000 }, 422))).toBe(
      "The file is too large. A settlement file can be up to 10 MB and 50000 lines.",
    );
    expect(describeIn("en", error("SETTLEMENT_DATE_MISMATCH", { file_date: "2026-11-17" }, 422))).toContain("2026-11-17");
    expect(describeIn("en", error("EXPORT_TOO_LARGE", { rows: 20000, max_rows: 10000, format: "xlsx", hint: "csv" }, 422))).toBe(
      "There are too many rows to export in one file (up to 10,000). Narrow the filters and try again. CSV takes more rows than Excel.",
    );
    expect(describeIn("en", error("EXPORT_PERIOD_TOO_LONG", { max_days: 366 }, 422))).toBe("The period is too long. Choose at most 366 days.");
  });

  it("says why two lines can't be paired", () => {
    for (const reason of ["not_found", "resolved", "reference_differs", "amount_differs", "wrong_kind"]) {
      const text = describeIn("en", error("PAIRED_ITEM_INVALID", { reason }, 422));
      expect(text).not.toBe(describeIn("en", error("PAIRED_ITEM_INVALID", {}, 422)));
    }
  });

  it("falls back to the shared messages for any other code", () => {
    expect(describeIn("en", error("STALE_VERSION"))).toBe("shared:STALE_VERSION");
    expect(describeIn("en", error("REFUND_PERMISSION_REQUIRED", {}, 403))).toBe("shared:REFUND_PERMISSION_REQUIRED");
    expect(describeIn("en", new Error("boom"))).toBe("Something went wrong. Please try again.");
  });

  it("reads a figure-less answer without the figure", () => {
    expect(describeIn("en", error("REFUND_AMOUNT_INVALID", {}, 422))).toBe("That amount can't be refunded. Check what is left to refund.");
    expect(describeIn("en", error("OPEN_REFUND_EXISTS", {}))).toContain("still open");
  });
});
