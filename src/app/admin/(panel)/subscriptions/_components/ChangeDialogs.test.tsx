import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { renderWithProviders } from "@/test/render";
import { candidate, liveOutDetail, pendingDetail, subscriptionDetail } from "@/test/subscriptionFixtures";
import { AssignWorkerDialog } from "./AssignWorkerDialog";
import { FreezeDialog } from "./FreezeDialog";
import { LiveOutDayDialog } from "./LiveOutDayDialog";
import { AutoRenewOffDialog, DeclineReviewDialog, RejectSubscriptionDialog, UnfreezeDialog } from "./StatusDialogs";

const api = vi.hoisted(() => {
  const names = [
    "rejectSubscription",
    "switchAutoRenewOff",
    "declineCancelReview",
    "unfreezeSubscription",
    "previewFreeze",
    "freezeSubscription",
    "assignWorker",
    "fetchWorkerCandidates",
    "previewLiveOutDay",
    "changeLiveOutDay",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const sub = subscriptionDetail();
const MANAGER = ["subscriptions.manage"];

function show(ui: (p: { onClose: () => void; onStale: () => void }) => ReactElement) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(ui({ onClose, onStale }), { permissions: MANAGER });
  return { onClose, onStale, user: userEvent.setup() };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchWorkerCandidates.mockResolvedValue([candidate(15, "Rosa"), candidate(16, "Joy R.", { current: true })]);
});

describe("A08 reject, auto-renew off and keeping after a review", () => {
  it("rejects with a reason of at least 3 characters, the version and a key", async () => {
    api.rejectSubscription.mockResolvedValue(pendingDetail());
    const { user, onClose } = show((p) => <RejectSubscriptionDialog subscription={pendingDetail()} {...p} />);
    await user.click(await screen.findByRole("button", { name: "Reject the request" }));
    expect(await screen.findByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    expect(api.rejectSubscription).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Reason (the customer sees it)", { exact: false }), "No capacity in the area");
    await user.click(screen.getByRole("button", { name: "Reject the request" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, reason, version, key] = api.rejectSubscription.mock.calls[0];
    expect([id, reason, version]).toEqual([31, "No capacity in the area", 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers a reject whose settlement the bank has not answered with a clear retry message", async () => {
    api.rejectSubscription.mockRejectedValue(apiError(502, "PAYMENT_RESULT_UNKNOWN"));
    const { user } = show((p) => <RejectSubscriptionDialog subscription={pendingDetail()} {...p} />);
    await user.type(await screen.findByLabelText("Reason (the customer sees it)", { exact: false }), "Duplicate request");
    await user.click(screen.getByRole("button", { name: "Reject the request" }));
    expect(await screen.findByText("The payment result is not known yet")).toBeInTheDocument();
  });

  it("switches auto-renew off only, with a reason and the version", async () => {
    api.switchAutoRenewOff.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <AutoRenewOffDialog subscription={sub} {...p} />);
    expect(await screen.findByText(/The next period's visits are released/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Why (for the record)", { exact: false }), "Customer called");
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.switchAutoRenewOff).toHaveBeenCalledWith(31, "Customer called", 7);
  });

  it("explains that switching off a failing renewal stops the charges and ends the term", async () => {
    api.switchAutoRenewOff.mockResolvedValue(sub);
    const failing = subscriptionDetail({ status: "renewal_failed", term_end_date: "2026-11-28" });
    const { user, onClose } = show((p) => <AutoRenewOffDialog subscription={failing} {...p} />);
    expect(await screen.findByText(/The failed renewal is given up: no more attempts charge the card/)).toBeInTheDocument();
    expect(screen.getByText("The subscription runs until Sat, 28 Nov 2026, the end of the paid term, and then ends.")).toBeInTheDocument();
    expect(screen.queryByText(/The next period's visits are released/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Why (for the record)", { exact: false }), "Customer asked to stop the charges");
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.switchAutoRenewOff).toHaveBeenCalledWith(31, "Customer asked to stop the charges", 7);
  });

  it("says a suspended subscription whose paid term is over ends now", async () => {
    show((p) => <AutoRenewOffDialog subscription={subscriptionDetail({ status: "suspended", term_end_date: "2026-10-01" })} {...p} />);
    expect(await screen.findByText("The paid term is already over, so the subscription ends now.")).toBeInTheDocument();
  });

  it("keeps the subscription after a review with a note", async () => {
    api.declineCancelReview.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <DeclineReviewDialog subscription={sub} {...p} />);
    await user.type(await screen.findByLabelText("Note to the customer's file", { exact: false }), "Customer changed their mind");
    await user.click(screen.getByRole("button", { name: "Keep the subscription" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.declineCancelReview).toHaveBeenCalledWith(31, "Customer changed their mind", 7);
  });

  it("maps 409 CANCEL_REVIEW_NOT_PENDING on keeping", async () => {
    api.declineCancelReview.mockRejectedValue(apiError(409, "CANCEL_REVIEW_NOT_PENDING"));
    const { user } = show((p) => <DeclineReviewDialog subscription={sub} {...p} />);
    await user.type(await screen.findByLabelText("Note to the customer's file", { exact: false }), "Keep it");
    await user.click(screen.getByRole("button", { name: "Keep the subscription" }));
    expect(await screen.findByText("This cancellation review was already closed.")).toBeInTheDocument();
  });

  it("unfreezes and reports the visits that stay frozen", async () => {
    api.unfreezeSubscription.mockResolvedValue({ data: sub, restored: [{ date: "2026-11-15" }], still_frozen: [{ date: "2026-11-18", reason: "visit_locked" }] });
    const frozen = subscriptionDetail({ status: "paused", freeze: { from: "2026-11-15", to: "2026-11-21", running: true } });
    const { user, onClose } = show((p) => <UnfreezeDialog subscription={frozen} {...p} />);
    expect(await screen.findByText("Frozen from Sun, 15 Nov 2026 to Sat, 21 Nov 2026.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unfreeze" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.unfreezeSubscription).toHaveBeenCalledWith(31, 7);
    expect(await screen.findByText("Unfrozen. Visits restored: 1; still frozen: 1.")).toBeInTheDocument();
  });
});

const freezePreview = (over: Record<string, unknown> = {}) => ({
  allowed: true,
  reason: null,
  from: "2026-11-15",
  to: "2026-11-21",
  days: 7,
  affected: [{ ulid: "a", date: "2026-11-15" }, { ulid: "b", date: "2026-11-18" }],
  appended_dates: ["2026-12-27", "2026-12-30"],
  new_term_end_date: "2026-12-05",
  fee_fils: 0,
  refund_fils: 0,
  freeze_days_used_this_period: 7,
  max_freeze_days: 14,
  explanation: { ar: "…", en: "…" },
  ...over,
});

async function chooseRange(user: ReturnType<typeof userEvent.setup>) {
  const from = await screen.findByLabelText("From", { exact: false });
  await user.clear(from);
  await user.type(from, "2026-11-15");
  await user.type(screen.getByLabelText("To", { exact: false }), "2026-11-21");
}

describe("A08 freeze dialog", () => {
  beforeEach(() => {
    api.previewFreeze.mockResolvedValue(freezePreview());
  });

  it("previews the visits frozen, the dates added and the new end, then freezes with that end date", async () => {
    api.freezeSubscription.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <FreezeDialog subscription={sub} {...p} />);
    await chooseRange(user);
    expect(await screen.findByText("Sat, 5 Dec 2026", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("7 of 14")).toBeInTheDocument();
    expect(screen.getByText("No fee and no refund: only the visits move.")).toBeInTheDocument();
    expect(api.previewFreeze).toHaveBeenLastCalledWith(31, { from: "2026-11-15", to: "2026-11-21" });
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, body, version, key] = api.freezeSubscription.mock.calls[0];
    expect([id, body, version]).toEqual([31, { from: "2026-11-15", to: "2026-11-21", expected_term_end_date: "2026-12-05" }, 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("asks for a reason when the package's limit is exceeded and the staff member may go over it", async () => {
    api.previewFreeze.mockRejectedValue(apiError(422, "FREEZE_TOO_LONG", { max_days: 14, requested: 20, used: 3, can_exceed: true }));
    const { user } = show((p) => <FreezeDialog subscription={sub} {...p} />);
    await chooseRange(user);
    expect(await screen.findByText("This freeze is longer than the package allows. Write a reason to freeze anyway.")).toBeInTheDocument();
  });

  it("shows the new end of the term after 409 TERMS_CHANGED and needs a fresh confirm", async () => {
    api.freezeSubscription
      .mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { preview: freezePreview({ new_term_end_date: "2026-12-12" }), changed: ["term_end_date"] }))
      .mockResolvedValueOnce(sub);
    const { user, onClose } = show((p) => <FreezeDialog subscription={sub} {...p} />);
    await chooseRange(user);
    await screen.findByText("Sat, 5 Dec 2026", { selector: "dd" });
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    expect(await screen.findByText("Sat, 12 Dec 2026", { selector: "dd" })).toHaveAttribute("data-changed", "true");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Freeze with the new end" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.freezeSubscription.mock.calls[1][1]).toMatchObject({ expected_term_end_date: "2026-12-12" });
  });

  it("never calls the current term end new: visits credited in a later, unpaid period say only where they are added", async () => {
    // The term end (28 Nov, the paid period's) stays: the credited visits are added in period 2, after it.
    api.previewFreeze.mockResolvedValue(freezePreview({ new_term_end_date: "2026-11-28" }));
    api.freezeSubscription.mockResolvedValue(sub);
    const { user, onClose } = show((p) => <FreezeDialog subscription={sub} {...p} />);
    await chooseRange(user);
    expect(await screen.findByText("Sun, 27 Dec 2026")).toBeInTheDocument();
    expect(screen.queryByText("New end of the term")).not.toBeInTheDocument();
    expect(screen.queryByText("Sat, 28 Nov 2026")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The write still sends back the end date the API gave.
    expect(api.freezeSubscription.mock.calls[0][1]).toMatchObject({ expected_term_end_date: "2026-11-28" });
  });

  it("maps FREEZE_EXISTS and rejects a backwards range before any request", async () => {
    api.freezeSubscription.mockRejectedValue(apiError(409, "FREEZE_EXISTS", { from: "2026-11-15", to: "2026-11-21" }));
    const { user } = show((p) => <FreezeDialog subscription={sub} {...p} />);
    await chooseRange(user);
    await screen.findByText("Sat, 5 Dec 2026", { selector: "dd" });
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    expect(await screen.findByText("A freeze already exists. End it before freezing again.")).toBeInTheDocument();
    const to = screen.getByLabelText("To", { exact: false });
    await user.clear(to);
    await user.type(to, "2026-11-10");
    expect(screen.getAllByText("The last day is before the first.").length).toBeGreaterThan(0);
  });
});

describe("A08 assign a worker", () => {
  it("names a worker from the candidates, from a date, and lists the days she cannot cover", async () => {
    api.assignWorker.mockResolvedValue({ data: sub, assigned: ["2026-11-04", "2026-11-08"], kept: [], unfit: [{ date: "2026-11-11", reasons: ["leave"] }] });
    const { user, onClose } = show((p) => <AssignWorkerDialog subscription={sub} role="primary" {...p} />);
    const select = await screen.findByRole("combobox", { name: /^Worker/ });
    await waitFor(() => expect(within(select).getByRole("option", { name: /Rosa/ })).toBeInTheDocument());
    // The name is its own bidi run inside the option's text, so "Joy R." keeps its period before " · " in Arabic.
    expect(within(select).getByRole("option", { name: `${isolate("Joy R.")} · fits 8 of 8 visits · current` })).toBeInTheDocument();
    await user.selectOptions(select, "15");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("Days she cannot cover: 1")).toBeInTheDocument();
    expect(screen.getByText("On leave")).toBeInTheDocument();
    const [id, role, worker, from, version] = api.assignWorker.mock.calls[0];
    expect([id, role, worker, version]).toEqual([31, "primary", 15, 7]);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The answer stays until it is closed.
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole("button", { name: "Close" }).find((b) => b.textContent === "Close") as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the backup role with a null worker and offers no clear for a Live-out primary", async () => {
    api.assignWorker.mockResolvedValue({ data: sub, assigned: [], kept: [], unfit: [] });
    const withBackup = subscriptionDetail({ workers: { primary: { id: 14, name: "Maria S." }, backup: { id: 15, name: "Rosa" } } });
    const { user } = show((p) => <AssignWorkerDialog subscription={withBackup} role="backup" {...p} />);
    await user.click(await screen.findByRole("checkbox", { name: /^Clear the role/ }));
    await user.click(screen.getByRole("button", { name: /^Clear the role/ }));
    await waitFor(() => expect(api.assignWorker).toHaveBeenCalled());
    expect(api.assignWorker.mock.calls[0].slice(0, 3)).toEqual([31, "backup", null]);
  });

  it("does not let a Live-out primary be cleared", async () => {
    show((p) => <AssignWorkerDialog subscription={liveOutDetail()} role="primary" {...p} />);
    await screen.findByRole("combobox", { name: /^Worker/ });
    expect(screen.queryByRole("checkbox", { name: /^Clear the role/ })).not.toBeInTheDocument();
  });

  it("maps WORKER_NOT_ASSIGNABLE (the worker by the role and name the API gives, P4-242) and SAME_WORKER", async () => {
    api.assignWorker
      .mockRejectedValueOnce(apiError(422, "WORKER_NOT_ASSIGNABLE", { workers: [{ worker_id: 15, name: "Rosa", role: "backup", reason: "not_eligible", reasons: ["not_eligible"] }] }))
      .mockRejectedValueOnce(apiError(422, "SAME_WORKER"));
    const { user } = show((p) => <AssignWorkerDialog subscription={sub} role="backup" {...p} />);
    const select = await screen.findByRole("combobox", { name: /^Worker/ });
    await waitFor(() => expect(within(select).getByRole("option", { name: /Rosa/ })).toBeInTheDocument());
    await user.selectOptions(select, "15");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText(/cannot take the role/)).toBeInTheDocument();
    expect(screen.getByText(`Backup worker: ${isolate("Rosa")} · Not eligible for this service`)).toBeInTheDocument();
    expect(screen.queryByText(/^15 ·/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("The primary and the backup must be different workers.")).toBeInTheDocument();
  });

  it("words a day the assignment failed on for another reason, never the API's code (resource_conflict, error)", async () => {
    const answer = { data: sub, assigned: ["2026-11-04"], kept: [], unfit: [{ date: "2026-11-08", reasons: ["resource_conflict"] }, { date: "2026-11-11", reasons: ["error"] }] };
    api.assignWorker.mockResolvedValue(answer);
    const { user } = show((p) => <AssignWorkerDialog subscription={sub} role="primary" {...p} />);
    const select = await screen.findByRole("combobox", { name: /^Worker/ });
    await waitFor(() => expect(within(select).getByRole("option", { name: /Rosa/ })).toBeInTheDocument());
    await user.selectOptions(select, "15");
    await user.click(screen.getByRole("button", { name: "Assign" }));
    const days = await screen.findByRole("list", { name: "Days she cannot cover" });
    expect(within(days).getAllByText("Could not be assigned")).toHaveLength(2);
    expect(days).not.toHaveTextContent(/resource_conflict|error/);
  });

  it("names a refused worker as her own bidi run in Arabic, and words an unknown reason there too", async () => {
    api.assignWorker.mockResolvedValue({ data: sub, assigned: [], kept: [], unfit: [{ date: "2026-11-08", reasons: ["resource_conflict"] }] });
    renderWithProviders(<AssignWorkerDialog subscription={sub} role="primary" onClose={vi.fn()} onStale={vi.fn()} />, { permissions: MANAGER, locale: "ar" });
    const user = userEvent.setup();
    const select = await screen.findByRole("combobox", { name: /^العاملة/ });
    await waitFor(() => expect(within(select).getByRole("option", { name: `${isolate("Joy R.")} · الزيارات المناسبة: 8 من 8 · الحالية` })).toBeInTheDocument());
    await user.selectOptions(select, "15");
    await user.click(screen.getByRole("button", { name: "تعيين" }));
    const days = await screen.findByRole("list", { name: "أيام لا تستطيع تغطيتها" });
    expect(days).toHaveTextContent("تعذّر الإسناد");
    expect(days).not.toHaveTextContent(/resource_conflict/);
  });
});

/** As the API answers it: each day's substitute named, {id, name} (P4-241). */
const dayPreview = (over: Record<string, unknown> = {}) => ({
  days: [{ date: "2026-11-11", before: "service", after: "absence", substitute: { id: 15, name: "Rosa" }, credited: false }],
  term_end_date: "2026-11-28",
  conflicts: {},
  unfit: [],
  ...over,
});

describe("A08 Live-out day", () => {
  const detail = liveOutDetail();
  beforeEach(() => {
    api.previewLiveOutDay.mockResolvedValue(dayPreview());
  });

  it("marks an absence with a substitute from the candidates and previews the day", async () => {
    api.changeLiveOutDay.mockResolvedValue({ ...dayPreview(), data: detail });
    const { user, onClose } = show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="service" scope="this" {...p} />);
    expect(await screen.findByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Service → Absence")).toBeInTheDocument();
    const substitute = screen.getByLabelText("Substitute worker (optional)", { exact: false });
    await waitFor(() => expect(within(substitute).getByRole("option", { name: /Rosa/ })).toBeInTheDocument());
    await user.selectOptions(substitute, "15");
    await waitFor(() => expect(api.previewLiveOutDay).toHaveBeenLastCalledWith(32, "2026-11-11", { change: "absence", scope: "this", substitute_worker_id: 15 }));
    expect(await screen.findByText(`Substitute: ${isolate("Rosa")}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [id, date, body, version, key] = api.changeLiveOutDay.mock.calls[0];
    expect([id, date, body, version]).toEqual([32, "2026-11-11", { change: "absence", scope: "this", substitute_worker_id: 15 }, 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.fetchWorkerCandidates).toHaveBeenCalledWith(32, "backup", "2026-11-11");
  });

  it("applies to the following days until a date, and lists the days a substitute cannot cover", async () => {
    api.previewLiveOutDay.mockResolvedValue(dayPreview({ unfit: [{ date: "2026-11-12", worker_id: 15, reasons: ["leave"] }], days: [{ date: "2026-11-11", before: "service", after: "absence", substitute: null, credited: true, appended_date: "2026-11-29" }] }));
    api.changeLiveOutDay.mockResolvedValue({ ...dayPreview(), data: detail });
    const { user } = show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="service" scope="following" {...p} />);
    const until = await screen.findByLabelText("Until (optional)", { exact: false });
    await user.type(until, "2026-11-14");
    expect(await screen.findByText("Days the substitute cannot cover (credited instead)")).toBeInTheDocument();
    expect(screen.getByText("On leave")).toBeInTheDocument();
    expect(screen.getByText("credited")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.changeLiveOutDay).toHaveBeenCalled());
    expect(api.changeLiveOutDay.mock.calls[0][2]).toEqual({ change: "absence", scope: "following", until: "2026-11-14" });
  });

  it("puts an absence back to service and offers no other change", async () => {
    api.previewLiveOutDay.mockResolvedValue(dayPreview({ days: [{ date: "2026-11-11", before: "absence", after: "service", substitute: null, credited: false }] }));
    show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="absence" scope="this" {...p} />);
    const change = await screen.findByLabelText("Change to", { exact: false });
    expect(within(change).getAllByRole("option").map((o) => o.textContent)).toEqual(["Service"]);
    expect(screen.queryByLabelText("Substitute worker (optional)", { exact: false })).not.toBeInTheDocument();
  });

  it("never calls the current term end new: a credit in a later period says only where its day is added", async () => {
    // TRL-S2FB7Q: 16 Dec is in period 2 (not paid yet); the credit moves period 2's end, the term end (8 Dec) stays.
    const contract = liveOutDetail({ term_end_date: "2026-12-08" });
    api.previewLiveOutDay.mockResolvedValue(
      dayPreview({ days: [{ date: "2026-12-16", before: "service", after: "absence", substitute: null, credited: true, appended_date: "2027-01-11" }], term_end_date: "2026-12-08" }),
    );
    const { unmount } = renderWithProviders(<LiveOutDayDialog subscription={contract} date="2026-12-16" type="service" scope="this" onClose={vi.fn()} onStale={vi.fn()} />, {
      permissions: MANAGER,
    });
    expect(await screen.findByText("added on Mon, 11 Jan 2027")).toBeInTheDocument();
    expect(screen.queryByText("New end of the term")).not.toBeInTheDocument();
    expect(screen.queryByText("Tue, 8 Dec 2026")).not.toBeInTheDocument();
    unmount();

    // A change inside the paid term moves its end: that new end is shown.
    api.previewLiveOutDay.mockResolvedValue(
      dayPreview({ days: [{ date: "2026-11-18", before: "service", after: "absence", substitute: null, credited: true, appended_date: "2026-12-09" }], term_end_date: "2026-12-09" }),
    );
    renderWithProviders(<LiveOutDayDialog subscription={contract} date="2026-11-18" type="service" scope="this" onClose={vi.fn()} onStale={vi.fn()} />, { permissions: MANAGER });
    expect(await screen.findByText("New end of the term")).toBeInTheDocument();
    expect(screen.getByText("Wed, 9 Dec 2026")).toBeInTheDocument();
  });

  it("names each day's substitute as the API does, without looking her up among the candidates", async () => {
    // Back to service: the primary could not take the days back, so they stay absent with their substitutes.
    api.previewLiveOutDay.mockResolvedValue(
      dayPreview({
        days: [
          { date: "2026-11-11", before: "absence", after: "absence", substitute: { id: 21, name: "Lina" }, credited: false },
          { date: "2026-11-12", before: "absence", after: "absence", substitute: { id: 99, name: "Joy M." }, credited: false },
        ],
        unfit: [{ date: "2026-11-11", worker_id: 14, reasons: ["leave"] }],
      }),
    );
    show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="absence" scope="following" {...p} />);
    expect(await screen.findByText(`Substitute: ${isolate("Lina")}`)).toBeInTheDocument();
    expect(screen.getByText(`Substitute: ${isolate("Joy M.")}`)).toBeInTheDocument();
    expect(screen.queryByText(/worker no\./)).not.toBeInTheDocument();
    expect(api.fetchWorkerCandidates).not.toHaveBeenCalled();
  });

  it("names a refused substitute with her role and why (422 WORKER_NOT_ASSIGNABLE)", async () => {
    api.changeLiveOutDay.mockRejectedValue(
      apiError(422, "WORKER_NOT_ASSIGNABLE", { workers: [{ worker_id: 15, name: "Rosa", role: "substitute", reason: "leave", reasons: ["leave"] }] }),
    );
    const { user, onClose } = show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="service" scope="this" {...p} />);
    await screen.findByText(`Substitute: ${isolate("Rosa")}`);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(`Substitute: ${isolate("Rosa")} · On leave`, { selector: "li" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("saves nothing before the preview of the days is on screen", async () => {
    api.previewLiveOutDay.mockReturnValue(new Promise(() => undefined));
    const { user } = show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="service" scope="following" {...p} />);
    await screen.findByLabelText("Change to", { exact: false });
    await user.click(screen.getByRole("button", { name: "Save" }));
    const notice = await screen.findByText(/Wait for the preview before saving/);
    expect(notice.closest("[role=alert]")).not.toBeNull();
    expect(api.changeLiveOutDay).not.toHaveBeenCalled();
  });

  it("saves nothing when the preview failed", async () => {
    api.previewLiveOutDay.mockRejectedValue(apiError(500, "SERVER_ERROR"));
    const { user } = show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-11" type="service" scope="this" {...p} />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Wait for the preview before saving/)).toBeInTheDocument();
    expect(api.changeLiveOutDay).not.toHaveBeenCalled();
  });

  it("explains why a day cannot be edited (DAY_NOT_EDITABLE) from the preview", async () => {
    api.previewLiveOutDay.mockRejectedValue(apiError(422, "DAY_NOT_EDITABLE", { date: "2026-11-06", reason: "rest" }));
    show((p) => <LiveOutDayDialog subscription={detail} date="2026-11-06" type="service" scope="this" {...p} />);
    expect(await screen.findByText("This is a weekly rest day.")).toBeInTheDocument();
  });
});
