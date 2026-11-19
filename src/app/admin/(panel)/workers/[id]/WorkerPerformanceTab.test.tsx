import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { proposal, proposalsPage, stats, worker } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { WorkerPerformanceTab } from "./WorkerPerformanceTab";

const api = {
  fetchWorkerStats: vi.fn(),
  fetchProposals: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  reopenProposal: vi.fn(),
  recomputeProposal: vi.fn(),
};
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchWorkerStats: (...a: unknown[]) => api.fetchWorkerStats(...a),
  fetchProposals: (...a: unknown[]) => api.fetchProposals(...a),
  approveProposal: (...a: unknown[]) => api.approveProposal(...a),
  rejectProposal: (...a: unknown[]) => api.rejectProposal(...a),
  reopenProposal: (...a: unknown[]) => api.reopenProposal(...a),
  recomputeProposal: (...a: unknown[]) => api.recomputeProposal(...a),
}));

const HR = ["workers.view", "incentives.approve", "attendance.manage"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const open = (permissions: readonly string[] = HR, locale: "en" | "ar" = "en") => renderWithProviders(<WorkerPerformanceTab worker={worker()} />, { permissions, locale });
/** The proposals of the last ended month (2026-09 on the tests' clock) that the card's search finds. */
const month = (...rows: ReturnType<typeof proposal>[]) => api.fetchProposals.mockResolvedValue(proposalsPage(rows));
const user = () => userEvent.setup();

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  // As the API answers: `incentive` is the proposal of the month `from` falls in, and a month that has not ended has none.
  api.fetchWorkerStats.mockImplementation(async (_id: number, from: string, to: string) =>
    stats({
      period: { from, to },
      incentive: from >= "2026-10-01" ? null : { proposal_id: 41, period_start: `${from.slice(0, 7)}-01`, status: "proposed", proposed_fils: 35000, approved_fils: null },
    }),
  );
  month(proposal());
});

describe("A05 performance and incentives tab (workforce §5.5)", () => {
  it("shows the month's figures: visits and hours, asked for by name, rating, complaints, team arrivals, substitutions, attendance", async () => {
    open();
    // The period's figures are their own card (the incentive card below repeats some of the month's facts).
    const figures = within((await screen.findByText("31 · 124 h")).closest("section")!);
    expect(api.fetchWorkerStats).toHaveBeenCalledWith(3, "2026-10-01", "2026-10-23");
    expect(figures.getByText("Visits").parentElement).toHaveTextContent("31 · 124 h");
    expect(figures.getByText("Visits").parentElement).toHaveTextContent("130 h planned · 1 no-shows");
    expect(figures.getByText("Asked for by name").parentElement).toHaveTextContent("42%");
    expect(figures.getByText("Asked for by name").parentElement).toHaveTextContent("13 of 31 eligible visits");
    expect(figures.getByText("Rating").parentElement).toHaveTextContent("★ 4.90");
    expect(figures.getByText("Rating").parentElement).toHaveTextContent("20 ratings");
    expect(figures.getByText("Upheld complaints").parentElement).toHaveTextContent("0");
    expect(figures.getByText("Team arrivals").parentElement).toHaveTextContent("90%");
    expect(figures.getByText("Days worked").parentElement).toHaveTextContent("25 of 26 days");
    // The team's arrivals are the transport's, and the screen says so.
    expect(figures.getByText(/mostly the van's/)).toBeInTheDocument();
  });

  it("leaves out what the API holds back: no attendance block, and a rating or complaints it cannot read say so", async () => {
    api.fetchWorkerStats.mockResolvedValue(stats({ attendance: null, incentive: null, rating: null, complaints: null }));
    open(["workers.view"]);
    await screen.findByText("31 · 124 h");
    expect(screen.queryByText("Days worked")).not.toBeInTheDocument();
    expect(screen.getByText("Rating").parentElement).toHaveTextContent("Not available");
    expect(screen.getByText("Upheld complaints").parentElement).toHaveTextContent("Not available");
    expect(screen.queryByText(/Proposed incentive/)).not.toBeInTheDocument();
    expect(api.fetchProposals).not.toHaveBeenCalled();
  });

  it("shows the incentive card only to incentives.approve", async () => {
    open(["workers.view"]);
    await screen.findByText("31 · 124 h");
    expect(screen.queryByText(/Proposed incentive/)).not.toBeInTheDocument();
    expect(api.fetchProposals).not.toHaveBeenCalled();
  });

  it("shows the proposal waiting for a decision (the last ended month) with the default period, though this month has none", async () => {
    open();
    // The figures are this month's; the API's `incentive` for a period starting this month is null.
    await screen.findByText("31 · 124 h");
    expect(api.fetchWorkerStats).toHaveBeenCalledWith(3, "2026-10-01", "2026-10-23");
    expect(await screen.findByText("Proposed incentive for September 2026")).toBeInTheDocument();
    expect(api.fetchProposals).toHaveBeenCalledWith({ period: "2026-09", search: "DEMO-W01", perPage: 100 });
    expect(await screen.findByRole("button", { name: "Approve" })).toBeEnabled();
    // Another period for the figures does not move the card to another month.
    const u = user();
    await u.selectOptions(screen.getByRole("combobox", { name: "Period" }), "last3Months");
    await waitFor(() => expect(api.fetchWorkerStats).toHaveBeenLastCalledWith(3, "2026-08-01", "2026-10-23"));
    expect(screen.getByText("Proposed incentive for September 2026")).toBeInTheDocument();
    expect(new Set(api.fetchProposals.mock.calls.map((c) => (c[0] as { period: string }).period))).toEqual(new Set(["2026-09"]));
    expect(screen.getByRole("link", { name: "Open the month" })).toHaveAttribute("href", "/admin/workers/incentives?period=2026-09");
  });

  it("takes her own row from a search that matched others, and says when the month has no proposal for her yet", async () => {
    const other = proposal({ id: 50, worker: { ...proposal().worker, id: 30, employee_no: "DEMO-W010", display_name: "Other W." }, proposed_fils: 99000 });
    month(other);
    const { unmount } = open();
    expect(await screen.findByText("No incentive has been proposed for September 2026 yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the month" })).toHaveAttribute("href", "/admin/workers/incentives?period=2026-09");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    unmount();

    month(other, proposal({ id: 41 }));
    open();
    await user().click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    expect(dialog).toHaveTextContent("Maria S.");
    expect(within(dialog).getByLabelText(/Amount to approve/)).toHaveValue("350.00");
  });

  it("reads another period: last month's range, and a custom range checked before it is asked for", async () => {
    open();
    const u = user();
    await screen.findByText("31 · 124 h");
    await u.selectOptions(screen.getByRole("combobox", { name: "Period" }), "lastMonth");
    await waitFor(() => expect(api.fetchWorkerStats).toHaveBeenLastCalledWith(3, "2026-09-01", "2026-09-30"));
    api.fetchWorkerStats.mockClear();
    await u.selectOptions(screen.getByRole("combobox", { name: "Period" }), "custom");
    await u.clear(screen.getByLabelText("To"));
    await u.type(screen.getByLabelText("To"), "2026-10-30");
    expect(await screen.findByText("The period cannot end after today.")).toBeInTheDocument();
    expect(api.fetchWorkerStats).not.toHaveBeenCalledWith(3, expect.anything(), "2026-10-30");
  });

  it("shows the proposal's score breakdown, its dropped parts and the rule that ratings never change pay automatically", async () => {
    month(proposal({ scores: { hours: 10000, rating: undefined, punctuality: 10000 }, gates: ["max_absent_days"] }));
    open();
    expect(await screen.findByText("Proposed incentive for September 2026")).toBeInTheDocument();
    expect(await screen.findByText("Score breakdown")).toBeInTheDocument();
    const breakdown = within(screen.getByText("Score breakdown").closest("section")!);
    expect(breakdown.getByText("Rating").closest("li")).toHaveTextContent("no data");
    expect(breakdown.getByText("Hours").closest("li")).toHaveTextContent("100%");
    expect(screen.getByText("More absent days than the rule allows")).toBeInTheDocument();
    expect(screen.getByText("A rating never changes pay automatically: HR decides.")).toBeInTheDocument();
    expect(screen.getByText(/It is not sent to accounting before it is approved/)).toBeInTheDocument();
  });

  it("approves at the proposed amount without a reason, with the proposal's version", async () => {
    api.approveProposal.mockResolvedValue(proposal({ status: "approved", approved_fils: 35000, version: 2 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    expect(within(dialog).getByLabelText(/Amount to approve/)).toHaveValue("350.00");
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith(41, { approved_fils: 35000 }, 1));
    expect(await screen.findByText(/Incentive of .* approved\./)).toBeInTheDocument();
  });

  it("needs a reason for an edited amount and sends it with the amount in fils", async () => {
    api.approveProposal.mockResolvedValue(proposal({ status: "approved", approved_fils: 40000, version: 2 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Edit amount" }));
    const dialog = screen.getByRole("alertdialog", { name: /Edit and approve the incentive of/ });
    const amount = within(dialog).getByLabelText(/Amount to approve/);
    await u.clear(amount);
    await u.type(amount, "400");
    await u.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    expect(within(dialog).getByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    expect(api.approveProposal).not.toHaveBeenCalled();
    await u.type(within(dialog).getByLabelText(/Reason for the change/), "Covered two extra Friday visits");
    await u.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith(41, { approved_fils: 40000, adjust_reason: "Covered two extra Friday visits" }, 1));
  });

  it("says the month's figures changed on a 409 METRICS_STALE, and recomputes from the dialog", async () => {
    api.approveProposal.mockRejectedValueOnce(apiError(409, "METRICS_STALE", { ids: [41] }));
    api.recomputeProposal.mockResolvedValue(proposal({ version: 2 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/The figures behind this incentive \(attendance, leave, ratings or complaints\) changed after it was computed/)).toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(api.recomputeProposal).toHaveBeenCalledWith(41, 1));
    expect(await screen.findByText("Figures recomputed.")).toBeInTheDocument();
  });

  it("after a recompute in the dialog lowers the proposal, the untouched amount follows it: the old figure is never approved", async () => {
    api.approveProposal
      .mockRejectedValueOnce(apiError(409, "METRICS_STALE", { ids: [41] }))
      .mockResolvedValueOnce(proposal({ status: "approved", approved_fils: 20000, version: 3 }));
    api.recomputeProposal.mockResolvedValue(proposal({ proposed_fils: 20000, version: 2 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    await within(dialog).findByText(/The figures behind this incentive/);
    // An absence was recorded: the recompute drops the proposal to AED 200.00, and the page reads it again.
    month(proposal({ proposed_fils: 20000, version: 2 }));
    await u.click(within(dialog).getByRole("button", { name: "Recompute" }));
    expect(await within(dialog).findByText("The proposed amount changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The proposal is now ⁦AED 200.00⁩ (it was ⁦AED 350.00⁩). The amount to approve follows it.");
    expect(within(dialog).getByLabelText(/Amount to approve/)).toHaveValue("200.00");
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(2));
    expect(api.approveProposal.mock.calls[1]).toEqual([41, { approved_fils: 20000 }, 2]);
  });

  it("keeps an amount the person typed when the proposal changes under it, and says so", async () => {
    api.approveProposal
      .mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 2 }))
      .mockResolvedValueOnce(proposal({ status: "approved", approved_fils: 40000, version: 3 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Edit amount" }));
    const dialog = screen.getByRole("alertdialog", { name: /Edit and approve the incentive of/ });
    const amount = within(dialog).getByLabelText(/Amount to approve/);
    await u.clear(amount);
    await u.type(amount, "400");
    await u.type(within(dialog).getByLabelText(/Reason for the change/), "Covered two extra Friday visits");
    month(proposal({ proposed_fils: 20000, version: 2 }));
    await u.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    expect(await within(dialog).findByText("The proposed amount changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The amount you typed is kept: check it before approving.");
    expect(within(dialog).getByLabelText(/Amount to approve/)).toHaveValue("400");
    await u.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(2));
    expect(api.approveProposal.mock.calls[1]).toEqual([41, { approved_fils: 40000, adjust_reason: "Covered two extra Friday visits" }, 2]);
  });

  it("offers no Approve for an AED 0.00 proposal (the API approves 1 fils or more), only Edit amount or Reject", async () => {
    month(proposal({ proposed_fils: 0, score_bp: 5000 }));
    open();
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit amount" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("shows a stale proposal as needing a recompute and does not let it be approved", async () => {
    month(proposal({ metrics_stale_at: "2026-10-10T00:00:00+00:00" }));
    open();
    expect(await screen.findByText("Figures changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeEnabled();
  });

  it("rejects with a reason and reopens an approved one with a reason", async () => {
    api.rejectProposal.mockResolvedValue(proposal({ status: "rejected" }));
    const { unmount } = open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("alertdialog", { name: /Reject the incentive of/ });
    await u.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    await u.type(within(dialog).getByLabelText(/^Reason/), "Left early twice");
    await u.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith(41, "Left early twice", 1));
    unmount();

    month(proposal({ status: "approved", approved_fils: 35000, version: 3 }));
    api.reopenProposal.mockResolvedValue(proposal({ version: 4 }));
    open();
    await u.click(await screen.findByRole("button", { name: "Reopen" }));
    const reopen = screen.getByRole("alertdialog", { name: /Reopen the incentive of/ });
    await u.type(within(reopen).getByLabelText(/^Reason/), "Wrong amount");
    await u.click(within(reopen).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(api.reopenProposal).toHaveBeenCalledWith(41, "Wrong amount", 3));
  });

  it("after a 409 STALE_VERSION on a decision asks again with the version read now", async () => {
    api.approveProposal.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 2 })).mockResolvedValueOnce(proposal({ status: "approved", version: 3 }));
    open();
    const u = user();
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    month(proposal({ version: 2 }));
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/This incentive changed while you were working\. Check the figures and confirm again/)).toBeInTheDocument();
    // The amount did not change, so nothing is said about it.
    expect(within(dialog).queryByText("The proposed amount changed")).not.toBeInTheDocument();
    await u.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(2));
    expect(api.approveProposal.mock.calls.map((c) => c[2])).toEqual([1, 2]);
  });

  it("has an error state with a retry, and is written in Arabic", async () => {
    api.fetchWorkerStats.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    const { unmount } = open();
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("31 · 124 h")).toBeInTheDocument();
    unmount();
    open(HR, "ar");
    expect(await screen.findByText(/الحافز المقترح لشهر/)).toBeInTheDocument();
    expect(screen.getByText("التقييم لا يغيّر الأجر آليًا أبدًا: القرار للموارد البشرية.")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
