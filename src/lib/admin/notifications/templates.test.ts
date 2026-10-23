import { describe, expect, it } from "vitest";
import type { NotificationTemplate } from "../types";
import {
  filterTemplates,
  groupTemplates,
  insertToken,
  samplePayload,
  templateChanges,
  templateFormSchema,
  unknownPlaceholders,
  usedPlaceholders,
} from "./templates";

const template = (over: Partial<NotificationTemplate>): NotificationTemplate => ({
  id: 1,
  event_key: "booking.confirmed",
  event_label: "Booking confirmed",
  group: "bookings",
  audience: "customer",
  channel: "push",
  channel_label: "Push notifications",
  locale: "ar",
  subject: "تم تأكيد حجزك",
  body: "تم تأكيد حجزك {{reference}}.",
  is_active: true,
  version: 1,
  placeholders: [{ name: "reference", token: "{{reference}}", description: "Booking reference" }],
  updated_by: null,
  updated_at: null,
  ...over,
});

describe("notification template rules (A11)", () => {
  it("finds the placeholders a text uses, spaces inside the braces allowed", () => {
    expect(usedPlaceholders("Hi {{customer_name}}, {{ reference }} on {{date}} ({{reference}})")).toEqual(["customer_name", "reference", "date"]);
    expect(unknownPlaceholders("{{reference}} {{refund_note}}", ["reference", "date"])).toEqual(["refund_note"]);
    expect(usedPlaceholders(null)).toEqual([]);
  });

  it("inserts a placeholder at the caret, replacing a selection", () => {
    expect(insertToken("Booking  confirmed", "{{reference}}", 8, 8)).toEqual({ value: "Booking {{reference}} confirmed", caret: 21 });
    expect(insertToken("Booking XYZ", "{{reference}}", 8, 11)).toEqual({ value: "Booking {{reference}}", caret: 21 });
    expect(insertToken("Booking", " {{date}}", null, null)).toEqual({ value: "Booking {{date}}", caret: 16 });
  });

  it("groups by preference group and event, Arabic and English side by side, customers before staff", () => {
    const rows = [
      template({ id: 5, audience: "staff", channel: "in_app", locale: "en" }),
      template({ id: 2, locale: "en" }),
      template({ id: 1 }),
      template({ id: 9, event_key: "refund.succeeded", event_label: "Refund completed", group: "payments", channel: "email", locale: "ar" }),
      template({ id: 3, channel: "sms", channel_label: "SMS", locale: "ar" }),
    ];
    const groups = groupTemplates(rows);
    expect(groups.map((g) => g.group)).toEqual(["bookings", "payments"]);
    const confirmed = groups[0].events[0];
    expect(confirmed.rows.map((r) => `${r.audience}:${r.channel}:${r.ar?.id ?? "-"}:${r.en?.id ?? "-"}`)).toEqual([
      "customer:push:1:2",
      "customer:sms:3:-",
      "staff:in_app:-:5",
    ]);
  });

  it("filters by text, audience, channel and whether it is sent", () => {
    const rows = [template({ id: 1 }), template({ id: 2, channel: "sms", is_active: false, body: "Refund on its way" })];
    expect(filterTemplates(rows, { search: "refund", audience: "", channel: "", state: "" }).map((t) => t.id)).toEqual([2]);
    expect(filterTemplates(rows, { search: "", audience: "", channel: "", state: "active" }).map((t) => t.id)).toEqual([1]);
    expect(filterTemplates(rows, { search: "", audience: "staff", channel: "", state: "" })).toEqual([]);
  });

  it("checks subject, body length per channel and placeholders like the API", () => {
    const issues = (channel: NotificationTemplate["channel"], v: { subject: string; body: string }) => {
      const result = templateFormSchema(channel, ["reference"]).safeParse({ ...v, is_active: true, reason: "" });
      return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
    };
    expect(issues("push", { subject: " ", body: "Hi {{reference}}" })).toEqual(["subject:subject_required"]);
    // SMS shows no subject and allows 320 characters.
    expect(issues("sms", { subject: "", body: "x".repeat(320) })).toEqual([]);
    expect(issues("sms", { subject: "", body: "x".repeat(321) })).toEqual(["body:body_length"]);
    expect(issues("push", { subject: "Hi {{name}}", body: "{{nope}}" })).toEqual(["subject:unknown_placeholders", "body:unknown_placeholders"]);
    expect(issues("email", { subject: "Invoice", body: "   " })).toEqual(["body:body_required"]);
  });

  it("sends only what changed, with the reason when given", () => {
    const original = template({});
    expect(templateChanges(original, { subject: "تم تأكيد حجزك", body: "تم تأكيد حجزك {{reference}}.\r\n", is_active: true, reason: "x" })).toEqual({});
    expect(templateChanges(original, { subject: "تم تأكيد حجزك", body: "تم تأكيد طلبك {{reference}}.", is_active: false, reason: " Wording " })).toEqual({
      body: "تم تأكيد طلبك {{reference}}.",
      is_active: false,
      reason: "Wording",
    });
    // An SMS has no subject to send.
    expect(templateChanges(template({ channel: "sms", subject: null }), { subject: "ignored", body: "تم تأكيد حجزك {{reference}}.", is_active: true, reason: "" })).toEqual({});
  });

  it("sends only the sample values the admin typed", () => {
    expect(samplePayload({ reference: { ar: "", en: "" }, date: { ar: "الخميس", en: " " }, total: { ar: "100 د.إ", en: "AED 100" } })).toEqual({
      date: { ar: "الخميس" },
      total: { ar: "100 د.إ", en: "AED 100" },
    });
  });
});
