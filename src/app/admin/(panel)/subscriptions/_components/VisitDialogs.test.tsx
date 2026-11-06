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
import { CancelVisitByCompanyDialog, RescheduleRequestDialog, decisionFromOccurrence, decisionFromRequest } from "./VisitDecisionDialogs";

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
const move = (status = "available", reason: string | null = null) => ({ allowed: true, blockers: [], requires_approval: false, availability: { status, reason }, explanation: "" });

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

  it("says why a time is full or closed with the Scheduling reason (P4-245), never its code", async () => {
    api.previewVisitMove.mockResolvedValueOnce(move("full", "workers")).mockResolvedValueOnce(move("closed", "lead_time"));
    const { user } = show((p) => <MoveVisitDialog subscription={sub} visit={visit} {...p} />);
    await chooseSlot(user, "2");
    expect(await screen.findByText("Full · not enough workers")).toBeInTheDocument();
    const date = screen.getByLabelText("New date", { exact: false });
    await user.clear(date);
    await user.type(date, "2026-11-05");
    expect(await screen.findByText("Closed · too soon to book")).toBeInTheDocument();
    expect(screen.queryByText(/lead_time/)).not.toBeInTheDocument();
  });

  it("starts from the date and time a card was dropped on in A04, and checks them at once", async () => {
    show((p) => <MoveVisitDialog subscription={sub} visit={visit} initial={{ date: "2026-11-05", slotId: 2 }} {...p} />);
    expect(await screen.findByLabelText("New date", { exact: false })).toHaveValue("2026-11-05");
    await waitFor(() => expect(screen.getByLabelText("New time", { exact: false })).toHaveValue("2"));
    await waitFor(() => expect(api.previewVisitMove).toHaveBeenCalledWith(31, "01jocc2", { scope: "this", date: "2026-11-05", slot_template_id: 2 }));
    expect(await screen.findByText("Available")).toBeInTheDocument();
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
    { date: "2026-11-12", status: "unavailable", reason: "blackout" },
  ],
  price: { checks: [{ date: "2026-11-09", old_unit_fils: 12000, new_unit_fils: 12000 }, { date: "2026-11-12", old_unit_fils: 12000, new_unit_fils: 12000 }], allowed: true },
  term_end_date: "2026-11-30",
  conflicts: { "2026-11-12": "blackout" },
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

  it("words every date reason of the closed list (P4-245) on the new dates and the conflicts, in both languages", async () => {
    api.previewFollowing.mockResolvedValue(
      diff({
        new: [
          { date: "2026-11-09", status: "unavailable", reason: "workers" },
          { date: "2026-11-12", status: "unavailable", reason: "rule_closed" },
        ],
        conflicts: { "2026-11-09": "workers", "2026-11-12": "max_bookings" },
      }),
    );
    renderWithProviders(<EditFollowingDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE, locale: "ar" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "الأربعاء" }));
    await user.click(screen.getByRole("checkbox", { name: "الخميس" }));
    const box = (await screen.findByRole("region", { name: "ما الذي يتغير" })) as HTMLElement;
    expect(within(box).getByText("غير متاحة · لا يكفي عدد العاملات")).toBeInTheDocument();
    expect(within(box).getByText("غير متاحة · مغلق بقاعدة")).toBeInTheDocument();
    expect(box).toHaveTextContent("اكتمل حد الحجوزات");
    expect(box).not.toHaveTextContent(/workers|rule_closed|max_bookings/);
  });

  it("draws a price change's arrow the way Arabic reads: the old price, then the new one", async () => {
    // It was a hard-coded "→": drawn right to left, it pointed from the new price back to the old one.
    api.previewFollowing.mockResolvedValue(diff({ price: { checks: [{ date: "2026-11-09", old_unit_fils: 15000, new_unit_fils: 12000 }], allowed: true } }));
    renderWithProviders(<EditFollowingDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE, locale: "ar" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "الأربعاء" }));
    await user.click(screen.getByRole("checkbox", { name: "الخميس" }));
    const box = (await screen.findByRole("region", { name: "ما الذي يتغير" })) as HTMLElement;
    expect(within(box).getByText("150.00 د.إ ← 120.00 د.إ")).toBeInTheDocument();
    expect(box).not.toHaveTextContent("→");
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

  it("never calls the current term end new when the edit leaves it where it is", async () => {
    // The term end (28 Nov, the paid period's) stays: the new pattern's dates lie in it or in a later, unpaid period.
    api.previewFollowing.mockResolvedValue(diff({ term_end_date: "2026-11-28" }));
    api.writeVisit.mockResolvedValue({ data: sub, conflicts: {} });
    const { user, onClose } = show((p) => <EditFollowingDialog subscription={sub} visit={visit} {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: "Wednesday" }));
    await user.click(screen.getByRole("checkbox", { name: "Thursday" }));
    const box = (await screen.findByRole("region", { name: "What changes" })) as HTMLElement;
    expect(within(box).queryByText("New end of the term")).not.toBeInTheDocument();
    expect(within(box).queryByText("Sat, 28 Nov 2026")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save the new pattern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The write still sends back the end date the API gave.
    expect(api.writeVisit.mock.calls[0][2]).toMatchObject({ expected_term_end_date: "2026-11-28" });
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

  it("counts the days to choose with each language's forms: one rest day, one day, two days (no \"1 rest days\")", async () => {
    const liveOut = subscriptionDetail({ id: 32, type: "live_out", pattern: { days_of_week: null, rest_weekdays: [5], slot: null, pattern_from: "2026-11-01" } });
    const weekly = subscriptionDetail({ pattern: { ...sub.pattern, days_of_week: [3] } });
    const cases: [typeof sub, "en" | "ar", string][] = [
      [liveOut, "en", "Choose 1 rest day, as now."],
      [weekly, "en", "Choose 1 day, as now."],
      [sub, "en", "Choose 2 days, as now."],
      [liveOut, "ar", "اختر يوم راحة واحدًا كما هو الآن."],
      [weekly, "ar", "اختر يومًا واحدًا كما هو الآن."],
      [sub, "ar", "اختر يومين كما هما الآن."],
    ];
    for (const [subscription, locale, hint] of cases) {
      const { unmount } = renderWithProviders(<EditFollowingDialog subscription={subscription} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE, locale });
      expect(await screen.findByText(hint)).toBeInTheDocument();
      unmount();
    }
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

  it("never calls the current term end new: a visit added in a later, unpaid period says only where it is added", async () => {
    // TRS-C7H810-like: the term end (28 Nov) stays; the visit is added on 27 Dec, in period 2.
    api.previewSkip.mockResolvedValue(skipPreview({ appended_date: "2026-12-27", new_term_end_date: "2026-11-28" }));
    api.skipVisit.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <SkipDialog subscription={sub} visit={visit} {...p} />);
    expect(await screen.findByText("Sun, 27 Dec 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByText("New end of the term")).not.toBeInTheDocument();
    expect(screen.queryByText("Sat, 28 Nov 2026")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip the visit" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The write still sends back the end date the API gave.
    expect(api.skipVisit.mock.calls[0][2]).toBe("2026-11-28");
  });

  it("tells both moves of a skip in the paid term while the next period is open: the term's new end and the visit added after it (P4-218)", async () => {
    // Period 2 is open from 29 Nov: the term takes its first visit (1 Dec) and the visit is added at its end (30 Dec).
    api.previewSkip.mockResolvedValue(skipPreview({ appended_date: "2026-12-30", new_term_end_date: "2026-12-01" }));
    const { unmount } = renderWithProviders(<SkipDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE });
    expect(await screen.findByText("Wed, 30 Dec 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Tue, 1 Dec 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("The later dates move up: this term now ends on Tue, 1 Dec 2026, and the next period gains Wed, 30 Dec 2026 at its end.")).toBeInTheDocument();
    unmount();

    // The visit added is the term's new end itself: one move, nothing more to say.
    api.previewSkip.mockResolvedValue(skipPreview());
    show((p) => <SkipDialog subscription={sub} visit={visit} {...p} />);
    expect((await screen.findAllByText("Sun, 29 Nov 2026", { selector: "dd" })).length).toBe(2);
    expect(screen.queryByText(/The later dates move up/)).not.toBeInTheDocument();
    expect(screen.queryByText(/still ends on/)).not.toBeInTheDocument();
  });

  it("says the term end stays when a visit of the open next period is skipped, the visit added at that period's end", async () => {
    // The visit skipped is in period 2: the term (to 28 Nov) keeps its end and period 2 gains 27 Dec. The customer app
    // says so (exception.shift.kept); the dialog showed the two dates with nothing joining them.
    api.previewSkip.mockResolvedValue(skipPreview({ appended_date: "2026-12-27", new_term_end_date: "2026-11-28" }));
    const { unmount } = renderWithProviders(<SkipDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE });
    expect(await screen.findByText("Sun, 27 Dec 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("This term still ends on Sat, 28 Nov 2026, and the next period gains Sun, 27 Dec 2026 at its end.")).toBeInTheDocument();
    expect(screen.queryByText(/The later dates move up/)).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<SkipDialog subscription={sub} visit={visit} onClose={vi.fn()} onStale={vi.fn()} />, { permissions: BASE, locale: "ar" });
    expect(await screen.findByText(/^تبقى نهاية هذه المدة في .+، وتُضاف .+ إلى آخر الفترة التالية\.$/)).toBeInTheDocument();
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
  const request = decisionFromOccurrence(withRequest)!;
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it("approves a customer's request and declines another with a note", async () => {
    api.decideRescheduleRequest.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} request={request} {...p} />);
    expect(await screen.findByText("Wed, 2 Dec 2026 · 15:00–19:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0].slice(0, 4)).toEqual([31, "01jocc5", { decision: "approve" }, 7]);
  });

  it("decides a request of the detail on its occurrence (P4-244), wherever the visit is in the series", async () => {
    api.decideRescheduleRequest.mockResolvedValue(sub);
    const row = { id: 9, booking_id: 95, occurrence_ulid: "01joccFAR", occurrence_date: "2027-01-10", from_date: "2027-01-10", date: "2027-01-12", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" }, requested_at: null };
    // Not among the detail's next 14 visits: the date it is served on comes from the request, without a time.
    const far = decisionFromRequest(row, sub.upcoming)!;
    expect(far).toEqual({ visit: "01joccFAR", current: { date: "2027-01-10", slot: null }, requested: { date: "2027-01-12", slot: row.slot } });
    expect(decisionFromRequest({ ...row, occurrence_ulid: null }, sub.upcoming)).toBeNull();
    // Among them: its time too.
    expect(decisionFromRequest({ ...row, occurrence_ulid: "01jocc0000000000000000501" }, sub.upcoming)?.current.slot).toEqual(sub.upcoming[0].slot);
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} request={far} {...p} />);
    expect(await screen.findByText("Sun, 10 Jan 2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0].slice(0, 3)).toEqual([31, "01joccFAR", { decision: "approve" }]);
  });

  it("declines with a reason", async () => {
    api.decideRescheduleRequest.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} request={request} {...p} />);
    await user.click(await screen.findByRole("radio", { name: "Decline" }));
    await user.type(screen.getByLabelText("Note to the customer"), "That day is full");
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0][2]).toEqual({ decision: "decline", reason: "That day is full" });
  });

  it("keeps the request pending when approving meets a full slot", async () => {
    api.decideRescheduleRequest.mockRejectedValue(apiError(409, "SLOT_FULL", { date: "2026-12-02", slot_template_id: 2 }));
    const { user, onClose } = show((p) => <RescheduleRequestDialog subscription={sub} request={request} {...p} />);
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
