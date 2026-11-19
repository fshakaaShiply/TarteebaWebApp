import { describe, expect, it } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { formatMonth } from "@/lib/admin/format";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { createTranslator } from "next-intl";
import { describeWaitlistError, describeWorkforceError, WAITLIST_ERROR_CODES, WORKFORCE_ERROR_CODES } from "./errors";

const err = (code: string, details: Record<string, unknown> = {}, status = 409) => new AdminApiError(status, { code, message: "", details });
const fallback = () => "fallback";

function translators(locale: "en" | "ar") {
  const messages = locale === "ar" ? ar : en;
  const work = createTranslator({ locale, messages, namespace: "admin.workers.errors" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const wait = createTranslator({ locale, messages, namespace: "admin.waitlist.errors" }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const f = {
    money: (fils: number) => `AED ${fils}`,
    date: (iso: string) => iso,
    month: (period: string) => formatMonth(`${period}-01`, locale),
    time: (iso: string) => iso.slice(11, 16),
  };
  return { work, wait, f };
}

describe("workforce error words (A5 §6)", () => {
  const { work, f } = translators("en");

  it("has a message in both languages for every code, with and without the figures", () => {
    for (const locale of ["en", "ar"] as const) {
      const t = translators(locale);
      for (const code of WORKFORCE_ERROR_CODES) {
        const text = describeWorkforceError(err(code), t.work, t.f, fallback);
        expect(text, `${code} (${locale})`).not.toBe("fallback");
        expect(text, `${code} (${locale})`).not.toMatch(/^admin\.|MISSING|\{/);
      }
      for (const code of WAITLIST_ERROR_CODES) {
        const text = describeWaitlistError(err(code), t.wait, t.f, fallback);
        expect(text, `${code} (${locale})`).not.toBe("fallback");
        expect(text, `${code} (${locale})`).not.toMatch(/^admin\.|MISSING|\{/);
      }
    }
  });

  it("puts the API's figures in: the dates attendance may be recorded for, the amount range, the month", () => {
    expect(describeWorkforceError(err("ATTENDANCE_DATE_INVALID", { min: "2026-09-22", max: "2026-10-23" }, 422), work, f, fallback)).toBe("Attendance can be recorded for dates from 2026-09-22 to 2026-10-23.");
    expect(describeWorkforceError(err("ATTENDANCE_DATE_INVALID", { min: null, max: "2026-10-23" }, 422), work, f, fallback)).toBe("Attendance can be recorded up to 2026-10-23.");
    expect(describeWorkforceError(err("AMOUNT_OUT_OF_RANGE", { min: -1000000, max: 1000000 }, 422), work, f, fallback)).toBe("The amount must be between AED -1000000 and AED 1000000.");
    expect(describeWorkforceError(err("PERIOD_NOT_CLOSED", { period: "2026-10" }, 422), work, f, fallback)).toContain("October 2026");
    expect(describeWorkforceError(err("PERIOD_INVALID", { max_days: 366 }, 422), work, f, fallback)).toContain("366");
    expect(describeWorkforceError(err("REASON_REQUIRED", { proposed_fils: 35000 }, 422), work, f, fallback)).toContain("AED 35000");
  });

  it("names the status in INVALID_STATE and says POSTING_BUSY changed nothing (a retry with the same key is safe)", () => {
    expect(describeWorkforceError(err("INVALID_STATE", { status: "posted", to: "approved" }), work, f, fallback)).toContain("posted");
    expect(describeWorkforceError(err("INVALID_STATE", { status: "weird" }), work, f, fallback)).toContain("current status");
    const busy = describeWorkforceError(err("POSTING_BUSY", { period: "2026-09" }, 503), work, f, fallback);
    expect(busy).toContain("September 2026");
    expect(busy).toContain("nothing was posted twice");
  });

  it("names the figures behind METRICS_STALE as the API's own message does", () => {
    expect(describeWorkforceError(err("METRICS_STALE", { ids: [1] }), work, f, fallback)).toBe(
      "The figures behind this incentive (attendance, leave, ratings or complaints) changed after it was computed. Recompute it before approving.",
    );
  });

  it("falls back for codes it does not own, and for anything that is not an API error", () => {
    expect(describeWorkforceError(err("STALE_VERSION", { current_version: 3 }), work, f, fallback)).toBe("fallback");
    expect(describeWorkforceError(new Error("x"), work, f, fallback)).toBe("fallback");
  });
});

describe("waitlist offer error words (A6 §5.2)", () => {
  const { wait, f } = translators("en");

  it("says why a place cannot be offered, with the API's figures", () => {
    expect(describeWaitlistError(err("WAITLIST_SLOT_UNAVAILABLE", { status: "full", remaining_workers: 1 }), wait, f, fallback)).toContain("1 cleaner is free now");
    expect(describeWaitlistError(err("WAITLIST_SLOT_UNAVAILABLE", { status: "closed" }), wait, f, fallback)).toContain("cut-off has passed");
    expect(describeWaitlistError(err("OFFER_LIMIT_REACHED", { max: 20 }), wait, f, fallback)).toContain("(20)");
    expect(describeWaitlistError(err("INVALID_STATE", { status: "converted" }), wait, f, fallback)).toBe("This request is booked, so no place can be offered.");
  });

  it("tells a live offer's end time and points to Notify again", () => {
    const text = describeWaitlistError(err("OFFER_LIVE", { expires_at: "2026-10-23T16:35:00+00:00" }), wait, f, fallback);
    expect(text).toContain("16:35");
    expect(text).toContain("Notify again");
  });

  it("leaves the rate limit to the shared words, which name the seconds", () => {
    expect(describeWaitlistError(err("RATE_LIMITED", { retry_after_seconds: 30 }, 429), wait, f, fallback)).toBe("fallback");
  });
});
