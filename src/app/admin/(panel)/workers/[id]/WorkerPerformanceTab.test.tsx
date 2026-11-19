import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { proposal, stats, worker } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { WorkerPerformanceTab } from "./WorkerPerformanceTab";

const api = {
  fetchWorkerStats: vi.fn(),
  fetchProposal: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  reopenProposal: vi.fn(),
  recomputeProposal: vi.fn(),
};
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchWorkerStats: (...a: unknown[]) => api.fetchWorkerStats(...a),
  fetchProposal: (...a: unknown[]) => api.fetchProposal(...a),
  approveProposal: (...a: unknown[]) => api.approveProposal(...a),
  rejectProposal: (...a: unknown[]) => api.rejectProposal(...a),
  reopenProposal: (...a: unknown[]) => api.reopenProposal(...a),
  recomputeProposal: (...a: unknown[]) => api.recomputeProposal(...a),
}));

const HR = ["workers.view", "incentives.approve", "attendance.manage"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const open = (permissions: readonly string[] = HR, locale: "en" | "ar" = "en") => renderWithProviders(<WorkerPerformanceTab worker={worker()} />, { permissions, locale });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  api.fetchWorkerStats.mockResolvedValue(stats());
  api.fetchProposal.mockResolvedValue(proposal());
});

describe("A05 performance and incentives tab (workforce §5.5)", () => {
  it("shows the month's figures: visits and hours, asked for by name, rating, complaints, team arrivals, substitutions, attendance", async () => {
    open();
    await screen.findByText("31 · 124 h");
    expect(api.fetchWorkerStats).toHaveBeenCalledWith(3, "2026-10-01", "2026-10-23");
    expect(screen.getByText("Visits").parentElement).toHaveTextContent("31 · 124 h");
    expect(screen.getByText("Visits").parentElement).toHaveTextContent("130 h planned · 1 no-shows".replace("130", "130"));
    expect(screen.getByText("Asked for by name").parentElement).toHaveTextContent("42%");
    expect(screen.getByText("Asked for by name").parentElement).toHaveTextContent("13 of 31 eligible visits");
    expect(screen.getByText("Rating").parentElement).toHaveTextContent("★ 4.90");
    expect(screen.getByText("Rating").parentElement).toHaveTextContent("20 ratings");
    expect(screen.getByText("Upheld complaints").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Team arrivals").parentElement).toHaveTextContent("90%");
    expect(screen.getByText("Days worked").parentElement).toHaveTextContent("25 of 26 days");
    // The team's arrivals are the transport's, and the screen says so.
    expect(screen.getByText(/mostly the van's/)).toBeInTheDocument();
  });

  it("leaves out what the API holds back: no attendance block, and a rating or complaints it cannot read say so", async () => {
    api.fetchWorkerStats.mockResolvedValue(stats({ attendance: null, incentive: null, rating: null, complaints: null }));
    open(["workers.view"]);
    await screen.findByText("31 · 124 h");
    expect(screen.queryByText("Days worked")).not.toBeInTheDocument();
    expect(screen.getByText("Rating").parentElement).toHaveTextContent("Not available");
    expect(screen.getByText("Upheld complaints").parentElement).toHaveTextContent("Not available");
    expect(screen.queryByText(/Proposed incentive/)).not.toBeInTheDocument();
    expect(api.fetchProposal).not.toHaveBeenCalled();
  });

  it("shows the incentive card only to incentives.approve, even when the stats name a proposal", async () => {
    open(["workers.view"]);
    await screen.findByText("31 · 124 h");
    expect(screen.queryByText(/Proposed incentive/)).not.toBeInTheDocument();
    expect(api.fetchProposal).not.toHaveBeenCalled();
  });

  it("reads another period: last month's range, and a custom range checked before it is asked for", async () => {
    open();
    const user = userEvent.setup();
    await screen.findByText("31 · 124 h");
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "lastMonth");
    await waitFor(() => expect(api.fetchWorkerStats).toHaveBeenLastCalledWith(3, "2026-09-01", "2026-09-30"));
    api.fetchWorkerStats.mockClear();
    await user.selectOptions(screen.getByRole("combobox", { name: "Period" }), "custom");
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-10-30");
    expect(await screen.findByText("The period cannot end after today.")).toBeInTheDocument();
    expect(api.fetchWorkerStats).not.toHaveBeenCalledWith(3, expect.anything(), "2026-10-30");
  });

  it("shows the proposal's score breakdown, its dropped parts and the rule that ratings never change pay automatically", async () => {
    api.fetchProposal.mockResolvedValue(proposal({ scores: { hours: 10000, rating: undefined, punctuality: 10000 }, gates: ["max_absent_days"] }));
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    expect(within(dialog).getByLabelText(/Amount to approve/)).toHaveValue("350.00");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith(41, { approved_fils: 35000 }, 1));
    expect(await screen.findByText(/Incentive of .* approved\./)).toBeInTheDocument();
  });

  it("needs a reason for an edited amount and sends it with the amount in fils", async () => {
    api.approveProposal.mockResolvedValue(proposal({ status: "approved", approved_fils: 40000, version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit amount" }));
    const dialog = screen.getByRole("alertdialog", { name: /Edit and approve the incentive of/ });
    const amount = within(dialog).getByLabelText(/Amount to approve/);
    await user.clear(amount);
    await user.type(amount, "400");
    await user.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    expect(within(dialog).getByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    expect(api.approveProposal).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "Covered two extra Friday visits");
    await user.click(within(dialog).getByRole("button", { name: "Approve this amount" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith(41, { approved_fils: 40000, adjust_reason: "Covered two extra Friday visits" }, 1));
  });

  it("says the month's figures changed on a 409 METRICS_STALE, and recomputes from the dialog", async () => {
    api.approveProposal.mockRejectedValueOnce(apiError(409, "METRICS_STALE", { ids: [41] }));
    api.recomputeProposal.mockResolvedValue(proposal({ version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/The figures behind this incentive \(attendance, leave, ratings or complaints\) changed after it was computed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(api.recomputeProposal).toHaveBeenCalledWith(41, 1));
    expect(await screen.findByText("Figures recomputed.")).toBeInTheDocument();
  });

  it("shows a stale proposal as needing a recompute and does not let it be approved", async () => {
    api.fetchProposal.mockResolvedValue(proposal({ metrics_stale_at: "2026-10-10T00:00:00+00:00" }));
    open();
    expect(await screen.findByText("Figures changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recompute" })).toBeEnabled();
  });

  it("rejects with a reason and reopens an approved one with a reason", async () => {
    api.rejectProposal.mockResolvedValue(proposal({ status: "rejected" }));
    const { unmount } = open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("alertdialog", { name: /Reject the incentive of/ });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Reason/), "Left early twice");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.rejectProposal).toHaveBeenCalledWith(41, "Left early twice", 1));
    unmount();

    api.fetchProposal.mockResolvedValue(proposal({ status: "approved", approved_fils: 35000, version: 3 }));
    api.reopenProposal.mockResolvedValue(proposal({ version: 4 }));
    open();
    await user.click(await screen.findByRole("button", { name: "Reopen" }));
    const reopen = screen.getByRole("alertdialog", { name: /Reopen the incentive of/ });
    await user.type(within(reopen).getByLabelText(/^Reason/), "Wrong amount");
    await user.click(within(reopen).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(api.reopenProposal).toHaveBeenCalledWith(41, "Wrong amount", 3));
  });

  it("after a 409 STALE_VERSION on a decision asks again with the version read now", async () => {
    api.approveProposal.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 2 })).mockResolvedValueOnce(proposal({ status: "approved", version: 3 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog", { name: /Approve the incentive of/ });
    api.fetchProposal.mockResolvedValue(proposal({ version: 2 }));
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText(/This incentive changed while you were working\. Check the figures and confirm again/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledTimes(2));
    expect(api.approveProposal.mock.calls.map((c) => c[2])).toEqual([1, 2]);
  });

  it("has an error state with a retry, and is written in Arabic", async () => {
    api.fetchWorkerStats.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(stats());
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
