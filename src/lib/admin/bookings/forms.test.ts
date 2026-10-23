import { describe, expect, it } from "vitest";
import {
  approveRequestSchema,
  assignmentReasonSchema,
  cancelSchema,
  dubaiInstant,
  proposeSchema,
  rejectSchema,
  rescheduleSchema,
  visitStatusSchema,
} from "./forms";

const messages = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.success ? {} : Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("A03 action dialogs", () => {
  it("reject: a reason code from the API's list; text required for “other”", () => {
    expect(messages(rejectSchema.safeParse({ reason_code: "", reason_text: "" }))).toEqual({ reason_code: "required" });
    expect(messages(rejectSchema.safeParse({ reason_code: "other", reason_text: " " }))).toEqual({ reason_text: "textRequired" });
    expect(rejectSchema.parse({ reason_code: "no_capacity", reason_text: "  " })).toEqual({ reason_code: "no_capacity", reason_text: null });
  });

  it("cancel: the refund is required when the policy cannot decide, and capped by what can be refunded", () => {
    const base = { party: "customer", reason_code: "customer_request", reason_text: "", refund: "" };
    expect(messages(cancelSchema("required", 12000).safeParse(base))).toEqual({ refund: "refundRequired" });
    expect(messages(cancelSchema("required", 12000).safeParse({ ...base, refund: "130" }))).toEqual({ refund: "refundTooHigh" });
    expect(messages(cancelSchema("optional", 12000).safeParse({ ...base, refund: "12.345" }))).toEqual({ refund: "refundInvalid" });
    expect(cancelSchema("optional", 12000).parse({ ...base, refund: "60" })).toEqual({
      party: "customer",
      reason_code: "customer_request",
      reason_text: null,
      refund_fils: 6000,
    });
    // Without refunds.create the field is hidden and nothing is sent: the policy amount applies.
    expect(cancelSchema("hidden", null).parse({ ...base, party: "company", refund: "99" })).toEqual({
      party: "company",
      reason_code: "customer_request",
      reason_text: null,
    });
  });

  it("alternatives: a date and slot per option, never the same one twice", () => {
    const parsed = proposeSchema.safeParse({
      options: [
        { service_date: "2026-10-26", slot_template_id: "1", note: "" },
        { service_date: "2026-10-26", slot_template_id: "1", note: "" },
        { service_date: "", slot_template_id: "", note: "" },
      ],
      note: "",
    });
    expect(messages(parsed)).toEqual({
      "options.1.slot_template_id": "duplicateOption",
      "options.2.service_date": "dateRequired",
      "options.2.slot_template_id": "slotRequired",
    });
    expect(
      proposeSchema.parse({ options: [{ service_date: "2026-10-26", slot_template_id: "2", note: " Evening " }], note: " Sorry " }),
    ).toEqual({ options: [{ service_date: "2026-10-26", slot_template_id: 2, note: "Evening" }], note: "Sorry" });
  });

  it("reschedule: a reason of 3 characters, 10 with an override", () => {
    const base = { service_date: "2026-10-26", slot_template_id: "2", reason: "ok", override: false };
    expect(messages(rescheduleSchema.safeParse(base))).toEqual({ reason: "reasonMin" });
    expect(messages(rescheduleSchema.safeParse({ ...base, reason: "short one", override: true }))).toEqual({ reason: "overrideReasonMin" });
    expect(rescheduleSchema.parse({ ...base, reason: "Customer asked", override: false })).toEqual({
      service_date: "2026-10-26",
      slot_template_id: 2,
      reason: "Customer asked",
    });
  });

  it("customer reschedule approval: an override needs its reason", () => {
    expect(messages(approveRequestSchema.safeParse({ note: "", override: true, reason: "" }))).toEqual({ reason: "reasonRequired" });
    expect(approveRequestSchema.parse({ note: "", override: false, reason: "" })).toEqual({ note: null });
  });

  it("assignment changes: 3 characters, 10 with an override", () => {
    expect(assignmentReasonSchema(false).safeParse({ reason: "ab" }).success).toBe(false);
    expect(assignmentReasonSchema(true).safeParse({ reason: "sick today" }).success).toBe(true);
    expect(assignmentReasonSchema(true).safeParse({ reason: "sick" }).success).toBe(false);
  });

  it("visit status: Dubai wall-clock time sent with its offset", () => {
    expect(dubaiInstant("2026-10-24", "10:25")).toBe("2026-10-24T10:25:00+04:00");
    expect(dubaiInstant("2026-10-24", "25:00")).toBeNull();
    expect(visitStatusSchema.parse({ status: "arrived", reason: "Driver phone off", date: "2026-10-24", time: "10:25" })).toEqual({
      status: "arrived",
      reason: "Driver phone off",
      at: "2026-10-24T10:25:00+04:00",
    });
    expect(messages(visitStatusSchema.safeParse({ status: "", reason: "x", date: "2026-10-24", time: "" }))).toEqual({
      status: "statusRequired",
      reason: "reasonMin",
      time: "timeInvalid",
    });
  });
});
