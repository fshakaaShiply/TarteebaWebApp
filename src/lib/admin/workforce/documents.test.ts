import { describe, expect, it } from "vitest";
import { document } from "@/test/workforceFixtures";
import {
  DOCUMENT_TYPES,
  canRenew,
  documentFormFrom,
  documentPatch,
  emptyDocumentForm,
  isArchived,
  maskedNumber,
  renewalFormFrom,
  validateDocumentForm,
} from "./documents";

const form = (over: Partial<ReturnType<typeof emptyDocumentForm>> = {}) => ({ ...emptyDocumentForm(), type: "residency", ...over });

describe("worker document form (workforce §5.1)", () => {
  it("offers the eight types of the API", () => {
    expect(DOCUMENT_TYPES).toEqual(["residency", "emirates_id", "work_permit", "passport", "medical", "insurance", "contract", "other"]);
  });

  it("asks for a type, and a title for an `other` document", () => {
    expect(validateDocumentForm(emptyDocumentForm(), { requireFile: false, fileChosen: false })).toEqual({ ok: false, errors: { type: "typeRequired" } });
    expect(validateDocumentForm(form({ type: "other" }), { requireFile: false, fileChosen: false })).toEqual({ ok: false, errors: { title: "titleRequired" } });
    expect(validateDocumentForm(form({ type: "other", title: "x".repeat(101) }), { requireFile: false, fileChosen: false })).toEqual({ ok: false, errors: { title: "titleLength" } });
  });

  it("checks the dates the way the request does: real dates, expiry not before issue", () => {
    expect(validateDocumentForm(form({ issued_at: "2026-02-30" }), { requireFile: false, fileChosen: false })).toMatchObject({ ok: false, errors: { issued_at: "dateInvalid" } });
    expect(validateDocumentForm(form({ issued_at: "2026-05-01", expires_at: "2026-04-30" }), { requireFile: false, fileChosen: false })).toMatchObject({ ok: false, errors: { expires_at: "expiryBeforeIssue" } });
    expect(validateDocumentForm(form({ issued_at: "2026-05-01", expires_at: "2026-05-01" }), { requireFile: false, fileChosen: false }).ok).toBe(true);
  });

  it("takes an alert window of 1 to 365 whole days, or none", () => {
    for (const bad of ["0", "366", "1.5", "-3", "abc"]) {
      expect(validateDocumentForm(form({ alert_days_before: bad }), { requireFile: false, fileChosen: false })).toMatchObject({ ok: false, errors: { alert_days_before: "alertDays" } });
    }
    expect(validateDocumentForm(form({ alert_days_before: "365" }), { requireFile: false, fileChosen: false })).toMatchObject({ ok: true, fields: { alert_days_before: 365 } });
    expect(validateDocumentForm(form(), { requireFile: false, fileChosen: false })).toMatchObject({ ok: true, fields: { alert_days_before: null } });
  });

  it("limits the number, the title and the notes, and wants the file on a new document only", () => {
    expect(validateDocumentForm(form({ number: "9".repeat(51) }), { requireFile: false, fileChosen: false })).toMatchObject({ errors: { number: "numberLength" } });
    expect(validateDocumentForm(form({ notes: "n".repeat(1001) }), { requireFile: false, fileChosen: false })).toMatchObject({ errors: { notes: "notesLength" } });
    expect(validateDocumentForm(form(), { requireFile: true, fileChosen: false })).toEqual({ ok: false, errors: { file: "fileRequired" } });
    expect(validateDocumentForm(form(), { requireFile: true, fileChosen: true }).ok).toBe(true);
  });

  it("trims what it sends and turns empty fields into null", () => {
    const result = validateDocumentForm(form({ number: "  784-1  ", notes: "  ", title: "" }), { requireFile: false, fileChosen: false });
    expect(result).toEqual({ ok: true, fields: { type: "residency", title: null, number: "784-1", issued_at: null, expires_at: null, alert_days_before: null, notes: null } });
  });
});

describe("editing, renewing and the private number", () => {
  it("fills an edit with everything but the number, which the API never returns in full", () => {
    expect(documentFormFrom(document({ notes: "n", title: null }))).toEqual({
      type: "residency",
      title: "",
      number: "",
      clearNumber: false,
      issued_at: "2024-03-15",
      expires_at: "2026-11-13",
      alert_days_before: "30",
      notes: "n",
    });
  });

  it("starts a renewal from the type, title and alert window, with new dates and number", () => {
    expect(renewalFormFrom(document({ type: "other", title: "Insurance card", alert_days_before: 14 }))).toEqual({ ...emptyDocumentForm(), type: "other", title: "Insurance card", alert_days_before: "14" });
  });

  it("renews only a current document that nothing renewed", () => {
    expect(canRenew(document())).toBe(true);
    expect(canRenew(document({ archived_at: "2026-10-01T00:00:00+00:00", superseded_by_id: 9 }))).toBe(false);
    expect(canRenew(document({ superseded_by_id: 9 }))).toBe(false);
    expect(isArchived(document({ archived_at: "2026-10-01T00:00:00+00:00" }))).toBe(true);
  });

  it("sends only the fields that changed: nothing at all for no change", () => {
    const doc = document({ notes: "n" });
    const same = validateDocumentForm(documentFormFrom(doc), { requireFile: false, fileChosen: false });
    if (!same.ok) throw new Error("form should be valid");
    expect(documentPatch(doc, same.fields, documentFormFrom(doc))).toEqual({});
    const changed = { ...documentFormFrom(doc), expires_at: "2027-11-13", notes: "kept" };
    const checked = validateDocumentForm(changed, { requireFile: false, fileChosen: false });
    if (!checked.ok) throw new Error("form should be valid");
    expect(documentPatch(doc, checked.fields, changed)).toEqual({ expires_at: "2027-11-13", notes: "kept" });
  });

  it("replaces the stored number only when one is typed, and clears it only on request", () => {
    const doc = document();
    const typed = { ...documentFormFrom(doc), number: "784-0000" };
    const checkedTyped = validateDocumentForm(typed, { requireFile: false, fileChosen: false });
    if (!checkedTyped.ok) throw new Error("valid");
    expect(documentPatch(doc, checkedTyped.fields, typed)).toEqual({ number: "784-0000" });
    const cleared = { ...documentFormFrom(doc), clearNumber: true };
    const checkedCleared = validateDocumentForm(cleared, { requireFile: false, fileChosen: false });
    if (!checkedCleared.ok) throw new Error("valid");
    expect(documentPatch(doc, checkedCleared.fields, cleared)).toEqual({ number: null });
  });

  it("lets an archived document change its notes only", () => {
    const doc = document({ archived_at: "2026-10-01T00:00:00+00:00", notes: null });
    const edited = { ...documentFormFrom(doc), notes: "old scan", expires_at: "2030-01-01", title: "x" };
    const checked = validateDocumentForm(edited, { requireFile: false, fileChosen: false });
    if (!checked.ok) throw new Error("valid");
    expect(documentPatch(doc, checked.fields, edited)).toEqual({ notes: "old scan" });
  });

  it("masks the number as the last characters only", () => {
    expect(maskedNumber("4821")).toBe("•••• 4821");
    expect(maskedNumber("")).toBeNull();
    expect(maskedNumber(null)).toBeNull();
  });
});
