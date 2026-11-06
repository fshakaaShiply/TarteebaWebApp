import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { slotTemplateOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { occurrence, subscriptionDetail } from "@/test/subscriptionFixtures";
import { EditFollowingDialog } from "./EditFollowingDialog";
import { MoveVisitDialog } from "./MoveVisitDialog";
import { SkipDialog, UndoSkipDialog } from "./SkipDialogs";
import { CancelVisitByCompanyDialog, RescheduleRequestDialog } from "./VisitDecisionDialogs";

const api = vi.hoisted(() => {
  const names = ["previewVisitMove", "previewFollowing", "writeVisit", "previewSkip", "skipVisit", "undoSkip", "decideRescheduleRequest", "fetchSubscriptionVisits"];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);
vi.mock("@/lib/admin/endpoints", () => ({ fetchSlotTemplateOptions: async () => slotTemplateOptions, fetchServiceOptions: async () => [] }));

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const BASE = ["subscriptions.manage", "bookings.view"];
const sub = subscriptionDetail();
const visit = occurrence({ scheduled_date: "2026-11-04", occurrence_date: "2026-11-04", ulid: "01jocc2" });

function show(ui: (p: { onClose: () => void; onStale: () => void }) => ReactElement, permissions = BASE) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(ui({ onClose, onStale }), { permissions });
  return { onClose, onStale, user: userEvent.setup() };
}

/** The message shown in an alert notice (not only as a hint). */
async function alertWith(text: string) {
  return waitFor(() => {
    const found = screen.getAllByText(text).find((el) => el.closest("[role=alert]"));
    if (!found) throw new Error(`no alert says: ${text}`);
    return found;
  });
}

/** The time list loads after the dialog opens: wait for the option, then choose it. */
async function chooseSlot(user: ReturnType<typeof userEvent.setup>, value: string) {
  const select = await screen.findByLabelText("New time", { exact: false });
  await waitFor(() => expect(within(select).getByRole("option", { name: /Evening/ })).toBeInTheDocument());
  await user.selectOptions(select, value);
}
const move = (status = "available") => ({ allowed: true, blockers: [], requires_approval: false, availability: { status, reason: null }, explanation: "" });

describe("A08 move one visit", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.previewVisitMove.mockResolvedValue(move());
  });

  it("checks the new date and time, then moves the visit with its version and one key", async () => {
    api.writeVisit.mockResolvedValue({ data: sub, conflicts: {} });
    const { user, onClose } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    const date = await screen.findByLabelText("New date", { exact: false });
    await user.clear(date);
    await user.type(date, "2026-11-05");
    await chooseSlot(user, "2");
    expect(await screen.findByText("Available")).toBeInTheDocument();
    expect(api.previewVisitMove).toHaveBeenLastCalledWith(31, "01jocc2", { scope: "this", date: "2026-11-05", slot_template_id: 2 });
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, ulid, body, version, key] = api.writeVisit.mock.calls[0];
    expect([id, ulid, version]).toEqual([31, "01jocc2", 7]);
    expect(body).toEqual({ scope: "this", action: "move", date: "2026-11-05", slot_template_id: 2 });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("offers the capacity override only with capacity.override, and needs a reason of 10 characters", async () => {
    api.previewVisitMove.mockResolvedValue(move("full"));
    api.writeVisit.mockResolvedValue({ data: sub, conflicts: {} });
    const { user, onClose } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />, [...BASE, "capacity.override"]);
    await chooseSlot(user, "2");
    expect(await screen.findByText(/full or closed\. You may go over the limit with a reason/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Go over the capacity limit/ }));
    await user.type(screen.getByLabelText(/Reason for the override/), "short");
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    expect(await alertWith("Write a reason of at least 10 characters.")).toBeTruthy();
    expect(api.writeVisit).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(/Reason for the override/));
    await user.type(screen.getByLabelText(/Reason for the override/), "Customer is a VIP, agreed with ops");
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.writeVisit.mock.calls[0][2]).toMatchObject({ override: true, override_reason: "Customer is a VIP, agreed with ops" });
    expect(api.previewVisitMove).toHaveBeenCalledWith(31, "01jocc2", expect.objectContaining({ override: true }));
  });

  it("has no override for staff without capacity.override and explains why the time cannot be used", async () => {
    api.previewVisitMove.mockResolvedValue(move("closed"));
    const { user } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    await chooseSlot(user, "2");
    expect(await screen.findByText(/moving there needs the capacity override permission/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Go over the capacity limit/ })).not.toBeInTheDocument();
  });

  it("maps SERIES_DATE_TAKEN and VISIT_LOCKED to clear messages and keeps the dialog open", async () => {
    api.writeVisit.mockRejectedValueOnce(apiError(409, "SERIES_DATE_TAKEN", { date: "2026-11-05", slot_template_id: 2 })).mockRejectedValueOnce(apiError(409, "VISIT_LOCKED", { lead_time_hours: 12 }));
    const { user, onClose } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    await chooseSlot(user, "2");
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    expect(await screen.findByText("Another visit of this subscription already uses that date and time.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    expect(await screen.findByText("This visit starts in less than 12 hours, so it can no longer be changed.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says why a move is blocked in the admin's language, never the API's codes, with the API's explanation", async () => {
    api.previewVisitMove.mockResolvedValue({ ...move("available"), allowed: false, blockers: ["policy", "price"], explanation: "لا يمكن نقل الزيارة إلى هذا الوقت." });
    renderWithProviders(<MoveVisitDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE, locale: "ar" });
    const user = userEvent.setup();
    const select = await screen.findByLabelText("الوقت الجديد", { exact: false });
    await waitFor(() => expect(select.querySelector('option[value="2"]')).not.toBeNull());
    await user.selectOptions(select, "2");
    expect(await screen.findByText("القواعد لا تسمح بنقل هذه الزيارة إلى هذا الوقت.")).toBeInTheDocument();
    expect(screen.getByText("سعر هذا الوقت أعلى من السعر المتفق عليه للزيارة.")).toBeInTheDocument();
    expect(screen.getByText("لا يمكن نقل الزيارة إلى هذا الوقت.")).toBeInTheDocument();
    expect(screen.queryByText(/policy|price/)).not.toBeInTheDocument();
  });

  it("does not repeat a full time as a blocker, and words an unknown blocker plainly", async () => {
    api.previewVisitMove.mockResolvedValue({ ...move("full"), allowed: false, blockers: ["slot", "budget"] });
    const { user } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    await chooseSlot(user, "2");
    expect(await screen.findByText(/moving there needs the capacity override permission/)).toBeInTheDocument();
    expect(screen.queryByText("That time cannot take the visit.")).not.toBeInTheDocument();
    expect(screen.getByText("This move cannot be made now.")).toBeInTheDocument();
    expect(screen.queryByText(/slot, budget/)).not.toBeInTheDocument();
  });

  it("does not move a visit to the time it already has", async () => {
    const { user } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    const select = await screen.findByLabelText("New time", { exact: false });
    await waitFor(() => expect(within(select).getByRole("option", { name: /Morning/ })).toBeInTheDocument());
    await waitFor(() => expect(select).toHaveValue("1"));
    await user.click(screen.getByRole("button", { name: "Move the visit" }));
    expect(await alertWith("This is the visit's current date and time.")).toBeTruthy();
    expect(api.writeVisit).not.toHaveBeenCalled();
  });
});

const diff = (over: Record<string, unknown> = {}) => ({
  from: "2026-11-04",
  kept: [{ date: "2026-11-04" }],
  replaced: [{ date: "2026-11-08" }, { date: "2026-11-11" }],
  new: [
    { date: "2026-11-09", status: "available" },
    { date: "2026-11-12", status: "unavailable", reason: "BLACKOUT" },
  ],
  price: { checks: [{ date: "2026-11-09", old_unit_fils: 12000, new_unit_fils: 12000 }, { date: "2026-11-12", old_unit_fils: 12000, new_unit_fils: 12000 }], allowed: true },
  term_end_date: "2026-11-30",
  conflicts: { "2026-11-12": "BLACKOUT" },
  ...over,
});

describe("A08 edit the following visits", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.previewFollowing.mockResolvedValue(diff());
  });

  it("previews kept, replaced and new dates with the per-date price check, then saves with the end date shown", async () => {
    api.writeVisit.mockResolvedValue({ data: sub, conflicts: {}, edit: diff() });
    const { user, onClose } = show((p) => <EditFollowingDialog subscription={sub} visit={visit} {...p} />);
    expect(await screen.findByText("Change the days or the time to see what happens.")).toBeInTheDocument();
    // Sunday and Wednesday become Monday and Thursday.
    await user.click(screen.getByRole("checkbox", { name: "Sunday" }));
    await user.click(screen.getByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Monday" }));
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    const box = (await screen.findByRole("region", { name: "What changes" })) as HTMLElement;
    expect(api.previewFollowing).toHaveBeenLastCalledWith(31, "01jocc2", { scope: "following", days_of_week: [1, 4] });
    expect(within(box).getByText("Not available · blackout day")).toBeInTheDocument();
    expect(within(box).getAllByText("AED 120.00 → AED 120.00")).toHaveLength(2);
    expect(within(box).getByText("Mon, 30 Nov 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the new pattern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.writeVisit.mock.calls[0][2]).toEqual({ scope: "following", days_of_week: [1, 4], expected_term_end_date: "2026-11-30", action: "edit" });
    expect(api.writeVisit.mock.calls[0][3]).toBe(7);
  });

  it("refuses to save a pattern whose price check fails, and shows 422 SERIES_PRICE_HIGHER with the date and prices", async () => {
    api.previewFollowing.mockResolvedValue(diff({ price: { checks: [{ date: "2026-11-09", old_unit_fils: 12000, new_unit_fils: 15000 }], allowed: false } }));
    const { user } = show((p) => <EditFollowingDialog subscription={sub} visit={visit} {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    expect(await screen.findByText(/A new date costs more than the one it replaces/)).toBeInTheDocument();
    expect(screen.getByText("costs more")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the new pattern" }));
    expect(api.writeVisit).not.toHaveBeenCalled();
  });

  it("shows a 422 SERIES_PRICE_HIGHER from the write", async () => {
    api.writeVisit.mockRejectedValue(apiError(422, "SERIES_PRICE_HIGHER", { date: "2026-11-09", old_unit_fils: 12000, new_unit_fils: 15000 }));
    const { user } = show((p) => <EditFollowingDialog subscription={sub} visit={visit} {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    await screen.findByRole("region", { name: "What changes" });
    await user.click(screen.getByRole("button", { name: "Save the new pattern" }));
    expect(await screen.findByText("A new date would cost more")).toBeInTheDocument();
    expect(screen.getByText(/Mon, 9 Nov 2026: AED 120\.00 now, AED 150\.00 after the edit/)).toBeInTheDocument();
  });

  it("shows the new end of the term after 409 TERMS_CHANGED and saves only on a fresh confirm", async () => {
    api.writeVisit.mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { preview: diff({ term_end_date: "2026-12-02" }), changed: ["term_end_date"] })).mockResolvedValueOnce({ data: sub, conflicts: {} });
    const { user, onClose } = show((p) => <EditFollowingDialog subscription={sub} visit={visit} {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    await screen.findByRole("region", { name: "What changes" });
    await user.click(screen.getByRole("button", { name: "Save the new pattern" }));
    expect(await screen.findByText("The terms changed")).toBeInTheDocument();
    expect(screen.getByText("Wed, 2 Dec 2026").closest("dd")).toHaveAttribute("data-changed", "true");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save with the new end" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.writeVisit.mock.calls[1][2]).toMatchObject({ expected_term_end_date: "2026-12-02" });
    // A new body, a new key: the 409 was an answer the API stored.
    expect(api.writeVisit.mock.calls[1][4]).not.toBe(api.writeVisit.mock.calls[0][4]);
  });

  it("edits the weekly rest days of a Live-out contract", async () => {
    const liveOut = subscriptionDetail({ id: 32, type: "live_out", pattern: { days_of_week: null, rest_weekdays: [5], slot: null, pattern_from: "2026-11-01" } });
    api.writeVisit.mockResolvedValue({ data: liveOut, conflicts: {} });
    const { user } = show((p) => <EditFollowingDialog subscription={liveOut} visit={visit} {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: "Friday" }));
    await user.click(screen.getByRole("checkbox", { name: "Saturday" }));
    await screen.findByRole("region", { name: "What changes" });
    expect(api.previewFollowing).toHaveBeenLastCalledWith(32, "01jocc2", { scope: "following", rest_weekdays: [6] });
  });
});

const skipPreview = (over: Record<string, unknown> = {}) => ({
  allowed: true,
  reason: null,
  visit: { ulid: "01jocc2", date: "2026-11-04", slot: null },
  appended_date: "2026-11-29",
  new_term_end_date: "2026-11-29",
  fee_fils: 0,
  refund_fils: 0,
  discount_effect: "kept",
  explanation: { ar: "…", en: "Your visit will be skipped and a visit is added." },
  ...over,
});

describe("A08 skip and undo skip", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.previewSkip.mockResolvedValue(skipPreview());
  });

  it("previews the added date and the new end, then skips with that end date", async () => {
    api.skipVisit.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <SkipDialog subscription={sub} visit={visit} {...p} />);
    expect((await screen.findAllByText("Sun, 29 Nov 2026", { selector: "dd" })).length).toBe(2);
    expect(screen.getByText("No fee and no refund: only the visits move.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip the visit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, ulid, expected, version, key] = api.skipVisit.mock.calls[0];
    expect([id, ulid, expected, version]).toEqual([31, "01jocc2", "2026-11-29", 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("asks which visit when opened from the header, offering the skippable upcoming ones", async () => {
    api.skipVisit.mockResolvedValue(sub);
    const { user } = show((p) => <SkipDialog subscription={sub} {...p} />);
    const select = await screen.findByRole("combobox", { name: /^Visit/ });
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    await user.selectOptions(select, "01jocc0000000000000000502");
    await waitFor(() => expect(api.previewSkip).toHaveBeenLastCalledWith(31, "01jocc0000000000000000502"));
  });

  it("says why a visit cannot be skipped and does not send it", async () => {
    api.previewSkip.mockResolvedValue(skipPreview({ allowed: false, reason: "visit_locked" }));
    const { user } = show((p) => <SkipDialog subscription={sub} visit={visit} {...p} />);
    expect(await screen.findByText("The visit starts too soon to be skipped.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip the visit" }));
    expect(api.skipVisit).not.toHaveBeenCalled();
  });

  it("shows the new end of the term after 409 TERMS_CHANGED", async () => {
    api.skipVisit.mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { preview: skipPreview({ new_term_end_date: "2026-12-06", appended_date: "2026-12-06" }), changed: ["term_end_date"] }));
    const { user } = show((p) => <SkipDialog subscription={sub} visit={visit} {...p} />);
    await screen.findAllByText("Sun, 29 Nov 2026", { selector: "dd" });
    await user.click(screen.getByRole("button", { name: "Skip the visit" }));
    expect(await screen.findByText("The terms changed")).toBeInTheDocument();
    expect(screen.getAllByText("Sun, 6 Dec 2026", { selector: "dd" })[0]).toHaveAttribute("data-changed", "true");
    expect(screen.getByRole("button", { name: "Skip with the new end" })).toBeInTheDocument();
  });

  it("undoes a skip from a row, and maps a full slot to its message", async () => {
    api.undoSkip.mockRejectedValueOnce(apiError(409, "SLOT_FULL", { date: "2026-11-18", slot_template_id: 1 })).mockResolvedValueOnce(sub);
    const skipped = occurrence({ ulid: "01jocc7", scheduled_date: "2026-11-18", state: "skipped", editable: { this: false, following: false, skip: false, undo_skip: true } });
    const { user, onClose } = show((p) => <UndoSkipDialog subscription={sub} visit={skipped} {...p} />);
    await user.click(await screen.findByRole("button", { name: "Undo the skip" }));
    expect(await screen.findByText("That time is full.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo the skip" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.undoSkip.mock.calls[1].slice(0, 3)).toEqual([31, "01jocc7", 7]);
  });

  it("finds the skipped visits itself when opened from the header", async () => {
    const skipped = occurrence({ ulid: "01jocc7", scheduled_date: "2026-11-18", state: "skipped", editable: { this: false, following: false, skip: false, undo_skip: true } });
    api.fetchSubscriptionVisits.mockResolvedValue({ data: [occurrence(), skipped], meta: { current_page: 1, per_page: 100, total: 2, last_page: 1 } });
    api.undoSkip.mockResolvedValue(sub);
    const { user } = show((p) => <UndoSkipDialog subscription={sub} {...p} />);
    await user.click(await screen.findByRole("button", { name: "Undo the skip" }));
    await waitFor(() => expect(api.undoSkip.mock.calls[0][1]).toBe("01jocc7"));
  });
});

describe("A08 customer requests and the company's miss", () => {
  const withRequest = occurrence({ ulid: "01jocc5", reschedule_request: { id: 5, date: "2026-12-02", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" } } });
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("approves a customer's request and declines another with a note", async () => {
    api.decideRescheduleRequest.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} visit={withRequest} {...p} />);
    expect(await screen.findByText("Wed, 2 Dec 2026 · 15:00–19:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0].slice(0, 4)).toEqual([31, "01jocc5", { decision: "approve" }, 7]);
  });

  it("declines with a reason", async () => {
    api.decideRescheduleRequest.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} visit={withRequest} {...p} />);
    await user.click(await screen.findByRole("radio", { name: "Decline" }));
    await user.type(screen.getByLabelText("Note to the customer"), "That day is full");
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0][2]).toEqual({ decision: "decline", reason: "That day is full" });
  });

  it("keeps the request pending when approving meets a full slot", async () => {
    api.decideRescheduleRequest.mockRejectedValue(apiError(409, "SLOT_FULL", { date: "2026-12-02", slot_template_id: 2 }));
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} visit={withRequest} {...p} />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("That time is full.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("credits a visit the company missed, with a required reason", async () => {
    api.writeVisit.mockResolvedValue({ data: sub, conflicts: {}, credited: { occurrence_id: 502, date: "2026-11-04", new_date: "2026-11-29" } });
    const { user, onClose } = show((p) => <CancelVisitByCompanyDialog subscription={sub} visit={visit} {...p} />);
    await user.click(await screen.findByRole("button", { name: "Cancel and credit" }));
    expect(await screen.findByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    expect(api.writeVisit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("What happened", { exact: false }), "No cleaner available");
    await user.click(screen.getByRole("button", { name: "Cancel and credit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.writeVisit.mock.calls[0].slice(0, 3)).toEqual([31, "01jocc2", { scope: "this", action: "cancel_by_company", reason: "No cleaner available" }]);
  });

  it("refuses a served visit with the API's invalid-state message", async () => {
    api.writeVisit.mockRejectedValue(apiError(409, "INVALID_STATE", { visit_status: "completed" }));
    const { user } = show((p) => <CancelVisitByCompanyDialog subscription={sub} visit={visit} {...p} />);
    await user.type(await screen.findByLabelText("What happened", { exact: false }), "Mistake");
    await user.click(screen.getByRole("button", { name: "Cancel and credit" }));
    expect(await screen.findByText(/no longer in a state where this can be done/)).toBeInTheDocument();
  });
});
