import { describe, expect, it } from "vitest";
import { editorKind, formatTimeRange, groupSettings, parseDraft, toDraft } from "./settings";
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

describe("editorKind", () => {
  it("picks an editor from the setting type", () => {
    expect(editorKind(setting({ type: "int", value: 15 }))).toBe("int");
    expect(editorKind(setting({ type: "money_fils", value: 1200 }))).toBe("money");
    expect(editorKind(setting({ type: "bool", value: false }))).toBe("bool");
    expect(editorKind(setting({ type: "string", value: "AED" }))).toBe("string");
    expect(editorKind(setting({ type: "time_range", value: { start: "09:00", end: "18:00" } }))).toBe("time_range");
    expect(editorKind(setting({ type: "json", value: {} }))).toBe("json");
    expect(editorKind(setting({ type: "something_new", value: 1 }))).toBe("json");
  });

  it("uses a select for string settings with known modes", () => {
    expect(editorKind(setting({ key: "payments.mode", type: "string", value: "authorize_capture" }))).toBe("enum");
  });

  it("uses chips for lists of strings and JSON for other lists", () => {
    expect(editorKind(setting({ type: "list", value: ["+971"] }))).toBe("chips");
    expect(editorKind(setting({ type: "list", value: [] }))).toBe("chips");
    expect(editorKind(setting({ type: "list", value: [{ start: "10:00", end: "14:00" }] }))).toBe("json-list");
  });
});

describe("toDraft", () => {
  it("shows money in AED and JSON pretty-printed", () => {
    expect(toDraft("money", 12050)).toBe("120.50");
    expect(toDraft("money", null)).toBe("");
    expect(toDraft("int", 30)).toBe("30");
    expect(toDraft("int", null)).toBe("");
    expect(toDraft("bool", true)).toBe(true);
    expect(toDraft("chips", ["a", "b"])).toEqual(["a", "b"]);
    expect(toDraft("time_range", { start: "09:00", end: "18:00" })).toBe('{\n  "start": "09:00",\n  "end": "18:00"\n}');
  });
});

describe("parseDraft: int", () => {
  it("accepts whole non-negative numbers", () => {
    expect(parseDraft("int", "15")).toEqual({ ok: true, value: 15 });
    expect(parseDraft("int", " 0 ")).toEqual({ ok: true, value: 0 });
  });

  it("rejects decimals, text, negatives and empty values", () => {
    expect(parseDraft("int", "1.5")).toEqual({ ok: false, error: "int" });
    expect(parseDraft("int", "abc")).toEqual({ ok: false, error: "int" });
    expect(parseDraft("int", "1e3")).toEqual({ ok: false, error: "int" });
    expect(parseDraft("int", "99999999999999999999")).toEqual({ ok: false, error: "int" });
    expect(parseDraft("int", "-5")).toEqual({ ok: false, error: "int_min" });
    expect(parseDraft("int", "")).toEqual({ ok: false, error: "required" });
  });

  it("allows clearing only a setting that is pending a decision", () => {
    expect(parseDraft("int", "", { allowNull: true })).toEqual({ ok: true, value: null });
  });
});

describe("parseDraft: money", () => {
  it("converts AED to integer fils", () => {
    expect(parseDraft("money", "120.50")).toEqual({ ok: true, value: 12050 });
    expect(parseDraft("money", "4,500")).toEqual({ ok: true, value: 450000 });
  });

  it("explains what is wrong", () => {
    expect(parseDraft("money", "12.345")).toEqual({ ok: false, error: "money_precision" });
    expect(parseDraft("money", "-1")).toEqual({ ok: false, error: "money_negative" });
    expect(parseDraft("money", "ten")).toEqual({ ok: false, error: "money" });
    expect(parseDraft("money", "")).toEqual({ ok: false, error: "required" });
    expect(parseDraft("money", "", { allowNull: true })).toEqual({ ok: true, value: null });
  });
});

describe("parseDraft: bool, string and enum", () => {
  it("saves booleans as booleans", () => {
    expect(parseDraft("bool", true)).toEqual({ ok: true, value: true });
    expect(parseDraft("bool", false)).toEqual({ ok: true, value: false });
  });

  it("trims text and requires a value", () => {
    expect(parseDraft("string", "  2026-11 ")).toEqual({ ok: true, value: "2026-11" });
    expect(parseDraft("string", "  ")).toEqual({ ok: false, error: "text_required" });
  });

  it("only accepts the offered options", () => {
    expect(parseDraft("enum", "window", { options: ["whole_day", "window"] })).toEqual({ ok: true, value: "window" });
    expect(parseDraft("enum", "other", { options: ["whole_day", "window"] })).toEqual({ ok: false, error: "option" });
  });
});

describe("parseDraft: chips", () => {
  it("trims items and keeps the order", () => {
    expect(parseDraft("chips", [" +971", "+966 "])).toEqual({ ok: true, value: ["+971", "+966"] });
    expect(parseDraft("chips", [])).toEqual({ ok: true, value: [] });
  });

  it("rejects empty and duplicate items", () => {
    expect(parseDraft("chips", ["a", " "])).toEqual({ ok: false, error: "list_empty_item" });
    expect(parseDraft("chips", ["a", "a "])).toEqual({ ok: false, error: "list_duplicate" });
  });
});

describe("parseDraft: JSON editors", () => {
  it("accepts a time range object and checks its times", () => {
    expect(parseDraft("time_range", '{"start":"09:00","end":"18:00","break_minutes":60}')).toEqual({
      ok: true,
      value: { start: "09:00", end: "18:00", break_minutes: 60 },
    });
    expect(parseDraft("time_range", '{"start":"9:00","end":"18:00"}')).toEqual({ ok: false, error: "time_format" });
    expect(parseDraft("time_range", '{"start":"18:00","end":"09:00"}')).toEqual({ ok: false, error: "time_order" });
    expect(parseDraft("time_range", '{"start":"09:00"}')).toEqual({ ok: false, error: "time_format" });
    expect(parseDraft("time_range", "[]")).toEqual({ ok: false, error: "json_object" });
    expect(parseDraft("time_range", "{oops")).toEqual({ ok: false, error: "json" });
  });

  it("accepts a list of slots and checks each one", () => {
    expect(parseDraft("json-list", '[{"start":"10:00","end":"14:00"},{"start":"15:00","end":"19:00"}]')).toEqual({
      ok: true,
      value: [
        { start: "10:00", end: "14:00" },
        { start: "15:00", end: "19:00" },
      ],
    });
    expect(parseDraft("json-list", '[{"start":"14:00","end":"10:00"}]')).toEqual({ ok: false, error: "time_order" });
    expect(parseDraft("json-list", '{"start":"10:00"}')).toEqual({ ok: false, error: "json_array" });
  });

  it("requires an object or array for generic JSON", () => {
    expect(parseDraft("json", '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseDraft("json", "[1,2]")).toEqual({ ok: true, value: [1, 2] });
    expect(parseDraft("json", "42")).toEqual({ ok: false, error: "json_object" });
    expect(parseDraft("json", "null")).toEqual({ ok: false, error: "json_object" });
  });
});

describe("formatTimeRange", () => {
  it("formats start and end", () => {
    expect(formatTimeRange({ start: "09:00", end: "18:00" })).toBe("09:00–18:00");
    expect(formatTimeRange("09:00")).toBeNull();
  });
});

describe("groupSettings", () => {
  it("orders known groups first and keeps new groups", () => {
    const groups = groupSettings([
      setting({ key: "a", group: "locale" }),
      setting({ key: "b", group: "zzz" }),
      setting({ key: "c", group: "booking" }),
      setting({ key: "d", group: "booking" }),
    ]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.key)])).toEqual([
      ["booking", ["c", "d"]],
      ["locale", ["a"]],
      ["zzz", ["b"]],
    ]);
  });
});
