import { describe, expect, it } from "vitest";
import { addDate, editorKind, groupSettings, parseDraft, toDraft } from "./settings";
import type { Setting } from "./types";

const setting = (over: Partial<Setting>): Setting => ({
  key: "x",
  value: null,
  type: "string",
  group: "booking",
  description: null,
  version: 1,
  updated_at: null,
  ...over,
});

describe("Phase 2 settings editors", () => {
  it("gives booking.working_hours the weekly hours editor and the holiday list a date editor", () => {
    expect(editorKind(setting({ key: "booking.working_hours", type: "weekly_hours", value: [] }))).toBe("weekly_hours");
    expect(editorKind(setting({ key: "calendar.public_holidays", type: "list", value: [] }))).toBe("dates");
    expect(editorKind(setting({ key: "calendar.public_holidays", type: "list", value: ["2026-12-02"] }))).toBe("dates");
    // Other string lists keep the chips editor.
    expect(editorKind(setting({ key: "auth.supported_country_codes", type: "list", value: ["+971"] }))).toBe("chips");
  });

  it("keeps the holiday list sorted on load", () => {
    expect(toDraft("dates", ["2026-12-03", "2026-12-02"])).toEqual(["2026-12-02", "2026-12-03"]);
  });

  it("saves holidays sorted, as real YYYY-MM-DD dates without duplicates", () => {
    expect(parseDraft("dates", ["2027-01-01", "2026-12-02"])).toEqual({ ok: true, value: ["2026-12-02", "2027-01-01"] });
    expect(parseDraft("dates", [])).toEqual({ ok: true, value: [] });
    expect(parseDraft("dates", ["2026-02-30"])).toEqual({ ok: false, error: "date_format" });
    expect(parseDraft("dates", ["02/12/2026"])).toEqual({ ok: false, error: "date_format" });
    expect(parseDraft("dates", ["2026-12-02", "2026-12-02"])).toEqual({ ok: false, error: "date_duplicate" });
  });

  it("adds one holiday at a time, refusing duplicates and invalid dates", () => {
    const first = addDate([], "2026-12-03");
    expect(first).toEqual({ ok: true, dates: ["2026-12-03"] });
    const second = addDate(["2026-12-03"], "2026-12-02");
    expect(second).toEqual({ ok: true, dates: ["2026-12-02", "2026-12-03"] });
    expect(addDate(["2026-12-02"], "2026-12-02")).toEqual({ ok: false, error: "date_duplicate" });
    expect(addDate([], "")).toEqual({ ok: false, error: "date_format" });
    // Arabic-Indic digits are read as Latin (D-13).
    expect(addDate([], "٢٠٢٦-١٢-٠٢")).toEqual({ ok: true, dates: ["2026-12-02"] });
  });

  it("orders the workforce group with the other known groups", () => {
    const groups = groupSettings([setting({ key: "a", group: "auth" }), setting({ key: "b", group: "workforce" })]);
    expect(groups.map((g) => g.group)).toEqual(["workforce", "auth"]);
  });
});
