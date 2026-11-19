import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CUSTOMER_ERROR_CODES, INVALID_STATES, REQUIRED_PROOFS } from "@/lib/admin/customers/errors";
import { CUSTOMER_STATUSES, BLOCKING_CODES, FAILURE_CODES, PRIVACY_STATUSES, PRIVACY_TYPES, PRIVACY_VERIFICATIONS, WAITING_ON_CODES } from "@/lib/admin/customers/types";
import { LEGAL_ERROR_CODES } from "@/lib/admin/legal/errors";
import { CONTENT_STATUSES, FAQ_PLACEHOLDERS, LEGAL_SLUGS } from "@/lib/admin/legal/types";
import { EMAIL_STATUSES } from "@/app/(customer)/email-verified/EmailVerifiedView";
import ar from "./ar.json";
import en from "./en.json";

/*
 * A07, the privacy queue, A11's legal pages and FAQ, and the customer web pages look message keys up at runtime (status
 * chips, verification methods, holds, failure reasons, error codes, form errors). Every key must exist in both languages, so
 * a missing one never shows as a raw key, and the placeholder and plural messages must format. The enum lists are the
 * contracts' (A4a, A4b).
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

const KEYS: [string, readonly string[]][] = [
  ["admin.customers.enums.status", CUSTOMER_STATUSES],
  ["admin.customers.errors.invalidState", INVALID_STATES],
  ["admin.customers.errors.verificationRequired", REQUIRED_PROOFS],
  ["admin.customers.privacyPending", PRIVACY_TYPES],
  ["admin.privacy.enums.type", PRIVACY_TYPES],
  ["admin.privacy.enums.status", PRIVACY_STATUSES],
  ["admin.privacy.enums.verification", PRIVACY_VERIFICATIONS],
  ["admin.privacy.enums.waitingOn", WAITING_ON_CODES],
  ["admin.privacy.enums.failure", FAILURE_CODES],
  ["admin.privacy.create.blocking", BLOCKING_CODES],
  ["admin.legal.slugs", LEGAL_SLUGS],
  ["admin.legal.hints", LEGAL_SLUGS],
  ["customerWeb.policies.slugs", LEGAL_SLUGS],
  ["customerWeb.help.policies", LEGAL_SLUGS],
  ["admin.faq.dialog.placeholders", FAQ_PLACEHOLDERS],
  ["customerWeb.emailVerified", EMAIL_STATUSES],
  ["admin.customers.addresses.property", ["villa", "apartment", "townhouse", "office"]],
  ["admin.customers.payments.payable", ["booking", "subscription_period", "wallet_topup"]],
];

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("A07, privacy and A11 content messages (%s)", (_locale, messages) => {
  it.each(KEYS)("has a message for every value of %s", (group, values) => {
    for (const value of values) {
      const message = get(messages, `${group}.${value}`);
      expect(message, `${group}.${value}`).toBeDefined();
    }
  });

  it("words every error code of the A07 and A11 routes", () => {
    for (const code of CUSTOMER_ERROR_CODES) expect(typeof get(messages, `admin.customers.errors.${code}`), code).toBe("string");
    for (const code of LEGAL_ERROR_CODES) expect(typeof get(messages, `admin.legal.errors.${code}`), code).toBe("string");
    for (const plain of ["VERSION_LABEL_TAKEN_plain", "PLACEHOLDER_UNKNOWN_plain", "FAQ_LIMIT_REACHED_plain"]) expect(typeof get(messages, `admin.legal.errors.${plain}`), plain).toBe("string");
    expect(typeof get(messages, "admin.customers.errors.OTP_INVALID_left")).toBe("string");
  });

  it("has a title and a body for each state of the data copy page and each page of the e-mail link", () => {
    for (const state of ["expired", "invalid", "started"]) {
      expect(typeof get(messages, `customerWeb.privacyExport.${state}.title`), state).toBe("string");
      expect(typeof get(messages, `customerWeb.privacyExport.${state}.body`), state).toBe("string");
    }
    for (const failure of ["wrongCode", "wrongCodeLeft", "codeExpired", "locked", "wait", "network"]) expect(typeof get(messages, `customerWeb.privacyExport.failures.${failure}`), failure).toBe("string");
    for (const status of EMAIL_STATUSES) {
      expect(typeof get(messages, `customerWeb.emailVerified.${status}.title`), status).toBe("string");
      expect(typeof get(messages, `customerWeb.emailVerified.${status}.body`), status).toBe("string");
    }
  });

  it("has a status word for every content page status", () => {
    // The API sends the label; the editor only needs the colour for the statuses it knows.
    expect([...CONTENT_STATUSES]).toEqual(["draft", "published", "superseded"]);
  });
});

describe("plural messages", () => {
  const say = (locale: "ar" | "en", namespace: string, key: string, values: Record<string, string | number>) =>
    (createTranslator({ locale, messages: locale === "ar" ? ar : en, namespace: namespace as never }) as unknown as (key: string, values: Record<string, string | number>) => string)(key, values);

  it("agrees the Arabic number of days and bookings", () => {
    expect(say("ar", "customerWeb.accountDeletion", "coolingDays", { days: 7 })).toContain("7 أيام");
    expect(say("ar", "customerWeb.accountDeletion", "coolingDays", { days: 1 })).toContain("يومًا واحدًا");
    expect(say("ar", "customerWeb.accountDeletion", "coolingDays", { days: 14 })).toContain("14 يومًا");
    expect(say("en", "customerWeb.accountDeletion", "coolingDays", { days: 1 })).toContain("1 day ");
    expect(say("en", "customerWeb.accountDeletion", "coolingDays", { days: 7 })).toContain("7 days");
    expect(say("ar", "admin.customers", "bookingsTotal", { count: 2 })).toBe("حجزان");
    expect(say("ar", "admin.customers", "bookingsTotal", { count: 14 })).toBe("14 حجزًا");
    expect(say("en", "admin.customers", "bookingsTotal", { count: 1 })).toBe("1 booking");
  });

  it("puts the attempts left of a wrong code in both languages", () => {
    expect(say("en", "customerWeb.privacyExport", "failures.wrongCodeLeft", { count: 1 })).toBe("That code isn't right. 1 attempt left.");
    expect(say("ar", "customerWeb.privacyExport", "failures.wrongCodeLeft", { count: 2 })).toContain("تبقت محاولتان");
  });

  it("formats the placeholder messages", () => {
    expect(say("en", "admin.customers", "deletionOn", { date: "24 Nov 2026" })).toBe("Deletion on 24 Nov 2026");
    expect(say("ar", "admin.customers", "deletionOn", { date: "24 نوفمبر 2026" })).toBe("الحذف في 24 نوفمبر 2026");
    expect(say("en", "admin.legal.publish", "title", { page: "Terms", version: "2026-11" })).toBe("Publish Terms, version 2026-11");
  });

  it("counts a customer's open bookings and subscriptions with real plurals", () => {
    expect(say("en", "admin.customers.profile", "openValue", { bookings: 1, subscriptions: 1 })).toBe("1 booking · 1 subscription");
    expect(say("en", "admin.customers.profile", "openValue", { bookings: 3, subscriptions: 0 })).toBe("3 bookings · 0 subscriptions");
    expect(say("ar", "admin.customers.profile", "openValue", { bookings: 1, subscriptions: 2 })).toBe("حجز واحد · اشتراكان");
    expect(say("ar", "admin.customers.profile", "openValue", { bookings: 0, subscriptions: 5 })).toBe("لا حجوزات · 5 اشتراكات");
    expect(say("ar", "admin.customers.profile", "openValue", { bookings: 11, subscriptions: 100 })).toBe("11 حجزًا · 100 اشتراك");
  });

  it("names the language whose legal text needs fixing", () => {
    expect(say("en", "admin.legal.editor", "fixLanguages", { which: "en" })).toBe("Check the marked fields in the English text before saving.");
    expect(say("en", "admin.legal.editor", "fixLanguages", { which: "both" })).toBe("Check the marked fields in the Arabic and the English text before saving.");
    expect(say("ar", "admin.legal.editor", "fixLanguages", { which: "ar" })).toBe("راجع الحقول المعلّمة في النص العربي قبل الحفظ.");
    expect(say("ar", "admin.legal.editor", "tabNeedsFix", { language: "الإنجليزية" })).toBe("الإنجليزية · يلزم التصحيح");
  });

  it("names the request's status when the queue can no longer act on it", () => {
    expect(say("en", "admin.privacy", "state.cancel", { id: 12, status: "Processing" })).toBe("Request #12 can no longer be cancelled: its status is now “Processing”.");
    expect(say("ar", "admin.privacy", "state.retry", { id: 12, status: "مكتمل" })).toBe("لم تعد إعادة محاولة الطلب رقم 12 ممكنة: حالته الآن «مكتمل».");
  });
});

describe("what the account deletion page promises", () => {
  it("does not say records are kept 'only' for the legal period: nothing purges them after it (P5-C20)", () => {
    expect(get(en, "customerWeb.accountDeletion.keptNote")).not.toMatch(/\bonly\b/);
    expect(get(ar, "customerWeb.accountDeletion.keptNote")).not.toContain("فقط");
  });

  it("says invoices keep the name and phone printed on them, and does not list complaints as removed", () => {
    expect(get(en, "customerWeb.accountDeletion.kept.invoices")).toMatch(/name and phone number/);
    expect(get(ar, "customerWeb.accountDeletion.kept.invoices")).toContain("اسمك ورقم هاتفك");
    expect(get(en, "customerWeb.accountDeletion.removed.notes")).not.toMatch(/^Your complaints/);
    expect(get(en, "admin.customers.banners.deletedBody")).not.toMatch(/no personal data is kept/);
  });
});
