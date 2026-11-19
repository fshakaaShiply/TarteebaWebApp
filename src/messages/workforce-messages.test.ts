import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { ATTENDANCE_STATUSES, SHEET_STATUSES } from "@/lib/admin/workforce/attendance";
import { RELEASE_REASON_CODES } from "@/lib/admin/workforce/assignment";
import { DOCUMENT_TYPES } from "@/lib/admin/workforce/documents";
import { INCENTIVE_STATUSES, SCORE_KEYS } from "@/lib/admin/workforce/incentives";
import { CUSTOMER_STATES, NOTIFY_BLOCKED_REASONS, WAITLIST_STATUS_CHOICES } from "@/lib/admin/workforce/waitlist";
import ar from "./ar.json";
import en from "./en.json";

/*
 * Enum coverage for slice W4 (workforce §8.2): every document type, attendance status and source, incentive status, gate
 * and score part, release reason, waitlist status and offer-blocking reason has a label in both languages, and the
 * Arabic is Arabic (not the English left in place). The plural messages cover every Arabic category.
 */

type Messages = { [key: string]: string | Messages };
const ARABIC = /[؀-ۿ]/;

function lookup(messages: Messages, path: string): string {
  const value = path.split(".").reduce<string | Messages | undefined>((node, part) => (node && typeof node === "object" ? node[part] : undefined), messages);
  if (typeof value !== "string") throw new Error(`missing ${path}`);
  return value;
}

const EXPECTED: [string, readonly string[]][] = [
  ["admin.workers.enums.documentType", DOCUMENT_TYPES],
  ["admin.workers.enums.attendanceStatus", [...ATTENDANCE_STATUSES, "none"]],
  ["admin.workers.enums.sheetStatus", SHEET_STATUSES],
  ["admin.workers.enums.source", ["derived", "manual"]],
  ["admin.workers.enums.releaseReason", [...RELEASE_REASON_CODES, "visit_closed"]],
  ["admin.workers.documents.state", ["valid", "expiring", "expiringToday", "expired", "no_expiry"]],
  ["admin.incentives.enums.status", INCENTIVE_STATUSES],
  ["admin.incentives.enums.gate", ["min_hours", "max_absent_days"]],
  ["admin.incentives.enums.score", SCORE_KEYS],
  ["admin.incentives.postings.kind", ["incentive", "adjustment"]],
  ["admin.incentives.tabs", ["proposals", "adjustments", "postings"]],
  ["admin.workers.performance.presets", ["thisMonth", "lastMonth", "last3Months", "custom"]],
  ["admin.workers.performance.problems", ["invalid", "order", "future", "tooLong"]],
  ["admin.waitlist.filters.status", WAITLIST_STATUS_CHOICES],
  ["admin.waitlist.blocked", NOTIFY_BLOCKED_REASONS],
  ["admin.waitlist.phase.slot", ["available", "limited", "full", "closed"]],
  ["admin.waitlist.errors.state", ["waiting", "notified", "converted", "expired", "cancelled"]],
  ["admin.workers.errors.incentiveState", INCENTIVE_STATUSES],
  ["admin.workers.detail.tabs", ["attendance", "documents", "performance"]],
  ["admin.nav", ["waitlist", "workersList", "attendance", "incentives", "incentivePostings"]],
  ["admin.waitlist.customerState", CUSTOMER_STATES],
  // The attendance evidence names a visit's status and a round's kind with the bookings' and trip planner's words: the
  // statuses the deriver counts as present (AttendanceDeriver::PRESENT_VISIT_STATUSES) and the round kinds.
  ["admin.bookings.enums.visit", ["arrived", "in_progress", "completed", "no_show_customer"]],
  ["admin.trips.enums.kind", ["dropoff", "pickup"]],
];

describe.each([
  ["en", en as Messages],
  ["ar", ar as Messages],
] as const)("workforce messages (%s)", (locale, messages) => {
  it.each(EXPECTED)("labels every value of %s", (group, values) => {
    for (const value of values) {
      const text = lookup(messages, `${group}.${value}`);
      expect(text.trim(), `${group}.${value}`).not.toBe("");
      if (locale === "ar") expect(text, `${group}.${value}`).toMatch(ARABIC);
    }
  });

  it("writes the attendance, document and incentive form errors in the language", () => {
    for (const group of [
      "admin.workers.documents.errors",
      "admin.workers.attendance.errors",
      "admin.incentives.errors",
      "admin.incentives.rules.errors",
    ]) {
      const node = group.split(".").reduce<Messages>((n, part) => n[part] as Messages, messages);
      for (const [key, text] of Object.entries(node)) {
        expect(typeof text, `${group}.${key}`).toBe("string");
        if (locale === "ar") expect(text as string, `${group}.${key}`).toMatch(ARABIC);
      }
    }
  });

  it("covers every plural category in the Arabic plurals of this slice", () => {
    if (locale !== "ar") return;
    const slice: Messages[] = [(messages.admin as Messages).incentives as Messages, (messages.admin as Messages).waitlist as Messages];
    const found: string[] = [];
    const walk = (node: Messages, path: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") {
          if (value.includes("plural,")) found.push(`${path}.${key}=${value}`);
        } else walk(value, `${path}.${key}`);
      }
    };
    slice.forEach((s) => walk(s, "ar"));
    expect(found.length).toBeGreaterThan(10);
    for (const entry of found) {
      for (const category of ["one {", "two {", "few {", "many {", "other {"]) expect(entry, entry).toContain(category);
    }
  });

  it("renders the plural messages for the numbers that need each Arabic form", () => {
    const t = createTranslator({ locale, messages, namespace: "admin.incentives.bulkApprove" }) as unknown as (key: string, values: Record<string, string | number>) => string;
    const title = (count: number) => t("title", { count });
    if (locale === "ar") {
      expect(title(1)).toBe("اعتماد حافز واحد");
      expect(title(2)).toBe("اعتماد حافزين");
      expect(title(5)).toBe("اعتماد 5 حوافز");
      expect(title(12)).toBe("اعتماد 12 حافزًا");
      expect(title(100)).toBe("اعتماد 100 حافز");
    } else {
      expect(title(1)).toBe("Approve 1 incentive");
      expect(title(3)).toBe("Approve 3 incentives");
    }
  });
});
