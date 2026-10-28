import { describe, expect, it } from "vitest";
import { bilingualText, editorKind, parseDraft, toDraft } from "./settings";

// Phase 3 settings (SettingsDefaults "Operations (Phase 3)"): whole numbers, a switch, a time and a bilingual text.
describe("Phase 3 settings editors", () => {
  it("gives each Phase 3 key its editor", () => {
    expect(editorKind({ key: "booking.alternative_proposal_hours", type: "int", value: 24 })).toBe("int");
    expect(editorKind({ key: "visit.auto_start_after_min", type: "int", value: 0 })).toBe("int");
    expect(editorKind({ key: "notifications.sms_on_confirm", type: "bool", value: true })).toBe("bool");
    // A06 extra round switches (Phase 3 polish).
    expect(editorKind({ key: "round.plan_extra_rounds", type: "bool", value: true })).toBe("bool");
    expect(editorKind({ key: "round.extra_round_prefer_other_van", type: "bool", value: false })).toBe("bool");
    expect(editorKind({ key: "reminder.day_before_time", type: "string", value: "18:00" })).toBe("time");
    expect(editorKind({ key: "refund.estimated_arrival_text", type: "json", value: { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" } })).toBe(
      "bilingual",
    );
    // Another shape stays a JSON editor, so nothing is lost.
    expect(editorKind({ key: "refund.estimated_arrival_text", type: "json", value: { ar: "x", en: "y", fr: "z" } })).toBe("json");
  });

  it("saves the reminder time as HH:MM (24-hour), Arabic-Indic digits accepted", () => {
    expect(toDraft("time", "18:00")).toBe("18:00");
    expect(parseDraft("time", "07:30")).toEqual({ ok: true, value: "07:30" });
    expect(parseDraft("time", "٠٧:٣٠")).toEqual({ ok: true, value: "07:30" });
    expect(parseDraft("time", "7:30")).toEqual({ ok: false, error: "time" });
    expect(parseDraft("time", "24:00")).toEqual({ ok: false, error: "time" });
    expect(parseDraft("time", "")).toEqual({ ok: false, error: "required" });
  });

  it("saves the refund estimate as {ar, en}, Arabic first, both required", () => {
    const value = { ar: "خلال 5 إلى 10 أيام عمل", en: "within 5 to 10 business days" };
    expect(toDraft("bilingual", value)).toEqual(value);
    const parsed = parseDraft("bilingual", { ar: "  خلال 3 أيام عمل ", en: " within 3 business days " });
    expect(parsed).toEqual({ ok: true, value: { ar: "خلال 3 أيام عمل", en: "within 3 business days" } });
    // The API compares the keys in order (array_keys == ['ar', 'en']).
    expect(Object.keys((parsed as { value: object }).value)).toEqual(["ar", "en"]);
    expect(parseDraft("bilingual", { ar: "خلال 3 أيام عمل", en: " " })).toEqual({ ok: false, error: "bilingual_required" });
    expect(bilingualText(value)).toEqual(value);
    expect(bilingualText("x")).toBeNull();
  });

  it("keeps whole-number limits for the minutes and hours settings", () => {
    expect(parseDraft("int", "0")).toEqual({ ok: true, value: 0 });
    expect(parseDraft("int", "-5")).toEqual({ ok: false, error: "int_min" });
    expect(parseDraft("bool", false)).toEqual({ ok: true, value: false });
  });
});
