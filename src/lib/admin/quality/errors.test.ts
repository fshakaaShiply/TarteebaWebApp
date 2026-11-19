import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { AdminApiError } from "../client";
import { describeQualityError } from "./errors";

const error = (code: string, details: Record<string, unknown> = {}, status = 409) => new AdminApiError(status, { code, message: "api words", details });
const words = (locale: "en" | "ar", e: unknown) =>
  describeQualityError(
    e,
    createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: "admin.quality.errors" }) as never,
    (fils) => `AED ${(fils / 100).toFixed(2)}`,
    () => "fallback",
  );

describe("A10 error words", () => {
  it("put the API's figures into our sentence", () => {
    expect(words("en", error("COMPENSATION_AMOUNT_INVALID", { max_fils: 12000 }, 422))).toBe("The amount must be at least AED 0.01 and at most AED 120.00.");
    expect(words("en", error("COMPENSATION_AMOUNT_INVALID", {}, 422))).toBe("That amount is not allowed for this visit.");
    expect(words("en", error("WORKERS_OUT_OF_RANGE", { min_workers: 1, max_workers: 2 }, 422))).toBe("The team must have between 1 and 2 cleaners.");
    expect(words("en", error("TOO_MANY_PENDING_UPLOADS", { max: 10 }, 429))).toContain("(the limit is 10)");
    expect(words("en", error("COMPLAINT_ALREADY_OPEN", { reference: "TC-4XQ8NM" }))).toContain("Another open case");
  });

  it("say why a compensation or a complaint is refused, from the code in details", () => {
    expect(words("en", error("COMPENSATION_TYPE_UNAVAILABLE", { type: "credit", reason: "wallet_disabled" }, 422))).toBe("The customer balance is not switched on yet.");
    expect(words("en", error("COMPENSATION_TYPE_UNAVAILABLE", { type: "credit", reason: "something_new" }, 422))).toBe("That kind of compensation is not available for this case.");
    expect(words("en", error("COMPLAINT_NOT_ALLOWED", { reason: "window_closed" }, 422))).toContain("time allowed");
    expect(words("en", error("ATTACHMENT_INVALID", { reason: "internal_only" }, 422))).toContain("internal note");
  });

  it("speak Arabic with the same figures", () => {
    expect(words("ar", error("COMPENSATION_AMOUNT_INVALID", { max_fils: 12000 }, 422))).toContain("AED 120.00");
    expect(words("ar", error("COMPENSATION_NOT_FINAL"))).toContain("لم يصل التعويض");
  });

  it("leave other codes and other errors to the shared words", () => {
    expect(words("en", error("STALE_VERSION", { current_version: 6 }))).toBe("fallback");
    expect(words("en", new Error("boom"))).toBe("fallback");
  });
});
