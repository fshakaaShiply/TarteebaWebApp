import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CANCEL_REASONS } from "@/lib/admin/bookings/actions";
import { PAYMENT_HEALTHS, SUBSCRIPTION_STATUSES } from "@/lib/admin/subscriptions/types";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

/*
 * The A08 screens look some message keys up at runtime (status, state and reason labels, error codes). These tests make
 * sure every key they use exists in both languages, so a missing key never shows up as a raw key on screen, and that
 * the two languages stay in parity under admin.subscriptions.
 */

function get(messages: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), messages);
}

function leaves(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const subscriptionsEn = get(en, "admin.subscriptions");
const subscriptionsAr = get(ar, "admin.subscriptions");

describe("A08 messages", () => {
  it("has the same keys and placeholders in Arabic and English", () => {
    expect(leaves(subscriptionsAr).sort()).toEqual(leaves(subscriptionsEn).sort());
    for (const key of leaves(subscriptionsEn)) {
      const a = get(subscriptionsAr, key);
      const e = get(subscriptionsEn, key);
      expect(typeof a, key).toBe("string");
      expect(placeholders(a as string), key).toEqual(placeholders(e as string));
    }
  });

  it("never mixes in the old Arabic name of Live-out, and keeps Live-out in Latin letters", () => {
    expect(JSON.stringify(subscriptionsAr)).not.toContain("إقامة");
    expect(get(ar, "admin.subscriptions.enums.type.live_out")).toBe("Live-out");
  });

  it("has a label for every status, payment state, period state, occurrence state and cancel reason", () => {
    for (const locale of [en, ar]) {
      for (const s of SUBSCRIPTION_STATUSES) expect(get(locale, `admin.subscriptions.enums.status.${s}`), s).toBeTypeOf("string");
      for (const h of PAYMENT_HEALTHS) expect(get(locale, `admin.subscriptions.enums.health.${h}`), h).toBeTypeOf("string");
      for (const p of ["upcoming", "pending_payment", "paid", "failed", "refunded_partial", "refunded", "closed", "void"]) expect(get(locale, `admin.subscriptions.enums.period.${p}`), p).toBeTypeOf("string");
      for (const o of ["planned", "held", "materialized", "skipped", "frozen", "credited", "holiday", "replaced", "dropped", "cancelled"]) expect(get(locale, `admin.subscriptions.enums.occurrence.${o}`), o).toBeTypeOf("string");
      for (const r of CANCEL_REASONS) expect(get(locale, `admin.subscriptions.enums.cancelReason.${r}`), r).toBeTypeOf("string");
    }
  });

  it("has copy for every error code the contracts name (A5a, A5b, A6)", () => {
    const codes = [
      "PAYMENT_RESULT_UNKNOWN", "PAYMENT_VERIFYING", "PAYMENT_NOT_CAPTURABLE", "CAPACITY_NOT_HELD", "PRIMARY_WORKER_REQUIRED", "WORKER_NOT_ASSIGNABLE", "SAME_WORKER",
      "STALE_VERSION", "TERMS_CHANGED", "VISIT_LOCKED", "SKIP_NOT_ALLOWED", "SKIP_LIMIT_REACHED", "NOT_SKIPPED", "SLOT_FULL", "SLOT_CLOSED", "FREEZE_NOT_ALLOWED",
      "FREEZE_EXISTS", "FREEZE_DATES_INVALID", "FREEZE_TOO_LONG", "FREEZE_EMPTY", "NOT_FROZEN", "RESCHEDULE_NOT_ALLOWED", "VISIT_NOT_SCHEDULED_YET", "SERIES_DATE_TAKEN",
      "RESCHEDULE_REQUEST_NOT_PENDING", "RESCHEDULE_PRICE_HIGHER", "SERIES_PRICE_HIGHER", "PATTERN_UNCHANGED", "DAYS_COUNT_MISMATCH", "REST_DAYS_COUNT_MISMATCH",
      "WEEKDAY_NOT_ALLOWED", "SLOT_NOT_AVAILABLE_FOR_SERVICE", "PRICE_NOT_AVAILABLE", "DATE_OUT_OF_RANGE", "NOT_LIVE_OUT", "DAY_NOT_EDITABLE", "RESOURCE_CONFLICT",
      "CAPACITY_SHORTFALL", "CANCEL_REVIEW_PENDING", "CANCEL_REVIEW_NOT_PENDING", "REFUND_PERMISSION_REQUIRED", "REFUND_AMOUNT_INVALID", "RENEWAL_NOT_DUE",
      "RENEWAL_IN_PROGRESS", "VISIT_IN_PROGRESS", "INVALID_STATE",
    ];
    for (const locale of [en, ar]) for (const code of codes) expect(get(locale, `admin.subscriptions.errors.codes.${code}`), code).toBeTypeOf("string");
    for (const locale of [en, ar]) {
      for (const reason of ["not_in_contract", "rest", "dropped", "past", "started", "not_applicable", "listed_holiday", "date_taken"]) {
        expect(get(locale, `admin.subscriptions.errors.dayNotEditable.${reason}`), reason).toBeTypeOf("string");
      }
    }
  });

  it("finds every message key the A08 sources use, in both languages", () => {
    const root = join(process.cwd(), "src", "app", "admin", "(panel)", "subscriptions");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const namespaces = [...source.matchAll(/useTranslations\("([^"]+)"\)/g)].map((m) => m[1]);
      // A reason dialog picks its group by prop (`admin.subscriptions.${ns}`).
      if (/useTranslations\(`admin\.subscriptions\.\$\{ns\}`\)/.test(source)) namespaces.push("admin.subscriptions.reject", "admin.subscriptions.autoRenew", "admin.subscriptions.declineReview");
      // Keys asked with `as never` are the optional ones (a group may lack them); the rest must exist.
      const keys = new Set([...source.matchAll(/\bt(?:\.has)?\(\s*"([^"]+)"(?!\s+as never)/g)].map((m) => m[1]));
      for (const key of keys) {
        const found = namespaces.some((ns) => get(en, `${ns}.${key}`) !== undefined && get(ar, `${ns}.${key}`) !== undefined);
        if (!found) missing.push(`${file.split("subscriptions/")[1]}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
