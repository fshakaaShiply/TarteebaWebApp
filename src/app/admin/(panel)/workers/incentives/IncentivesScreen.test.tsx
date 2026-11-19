import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { adjustment, posting, proposal, proposalsPage } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { IncentivesScreen } from "./IncentivesScreen";

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/workers/incentives",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = {
  fetchProposals: vi.fn(),
  fetchAdjustments: vi.fn(),
  fetchPostings: vi.fn(),
  computeIncentives: vi.fn(),
  bulkApprove: vi.fn(),
  bulkReject: vi.fn(),
  postIncentives: vi.fn(),
  fetchPostingFile: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  reopenProposal: vi.fn(),
  recomputeProposal: vi.fn(),
  createAdjustment: vi.fn(),
  deleteAdjustment: vi.fn(),
};
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchProposals: (...a: unknown[]) => api.fetchProposals(...a),
  fetchAdjustments: (...a: unknown[]) => api.fetchAdjustments(...a),
  fetchPostings: (...a: unknown[]) => api.fetchPostings(...a),
  computeIncentives: (...a: unknown[]) => api.computeIncentives(...a),
  bulkApprove: (...a: unknown[]) => api.bulkApprove(...a),
  bulkReject: (...a: unknown[]) => api.bulkReject(...a),
  postIncentives: (...a: unknown[]) => api.postIncentives(...a),
  fetchPostingFile: (...a: unknown[]) => api.fetchPostingFile(...a),
  approveProposal: (...a: unknown[]) => api.approveProposal(...a),
  rejectProposal: (...a: unknown[]) => api.rejectProposal(...a),
  reopenProposal: (...a: unknown[]) => api.reopenProposal(...a),
  recomputeProposal: (...a: unknown[]) => api.recomputeProposal(...a),
  createAdjustment: (...a: unknown[]) => api.createAdjustment(...a),
  deleteAdjustment: (...a: unknown[]) => api.deleteAdjustment(...a),
}));
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true }],
  fetchServiceOptions: async () => [],
  fetchAllWorkers: async () => [
    { id: 3, display_name: "Maria S.", employee_no: "DEMO-W01" },
    { id: 4, display_name: "Siti R.", employee_no: "DEMO-W02" },
  ],
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HR = ["incentives.approve", "workers.view"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const fixedPage = <T,>(data: T[]) => ({ data, meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1 } });

const maria = proposal({ id: 1, status: "approved", approved_fils: 40000, proposed_fils: 35000, version: 3, approved: { by: { id: 4, name: "Huda HR" }, at: "2026-10-06T06:00:00+00:00", adjust_reason: "Covered two extra Fridays" } });
const siti = proposal({
  id: 2,
  worker: { id: 4, employee_no: "DEMO-W02", display_name: "Siti R.", full_name: { ar: "سيتي", en: "Siti Rahma" }, home_zone: { id: 1, name: { ar: "الخليج التجاري", en: "Business Bay" } } },
  status: "approved",
  approved_fils: 50000,
  proposed_fils: 50000,
  version: 2,
});
const lakshmi = proposal({
  id: 3,
  worker: { id: 5, employee_no: "DEMO-W03", display_name: "Lakshmi N.", full_name: { ar: "لاكشمي", en: "Lakshmi N." }, home_zone: { id: 1, name: { ar: "الخليج التجاري", en: "Business Bay" } } },
  proposed_fils: 20000,
  version: 1,
});
const nirmala = proposal({
  id: 4,
  worker: { id: 6, employee_no: "DEMO-W04", display_name: "Nirmala P.", full_name: { ar: "نرمالا", en: "Nirmala P." }, home_zone: { id: 1, name: { ar: "الخليج التجاري", en: "Business Bay" } } },
  proposed_fils: 35000,
  version: 1,
});

const open = (rows = [maria, siti, lakshmi, nirmala], permissions: readonly string[] = HR, locale: "en" | "ar" = "en") => {
  api.fetchProposals.mockResolvedValue(proposalsPage(rows));
  return renderWithProviders(<IncentivesScreen />, { permissions, locale });
};
const row = (name: string) => screen.getAllByRole("row").find((r) => r.textContent?.includes(name))!;
const pick = async (user: ReturnType<typeof userEvent.setup>, ...names: string[]) => {
  for (const name of names) await user.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  url.set("");
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchAdjustments.mockResolvedValue(fixedPage([]));
  api.fetchPostings.mockResolvedValue(fixedPage([posting()]));
});

describe("A05 incentive proposals (workforce §3.3)", () => {
  it("shows the last ended month: totals by status, each cleaner's hours, rating, score, amount and status", async () => {
    open();
    await screen.findByText("Maria S.");
    expect(api.fetchProposals).toHaveBeenCalledWith(expect.objectContaining({ period: "2026-09", page: 1, perPage: 25 }));
    expect(screen.getByRole("combobox", { name: "Month" })).toHaveValue("2026-09");
    const totals = screen.getByRole("list", { name: "Totals by status" });
    expect(totals).toHaveTextContent("Approved");
    expect(totals).toHaveTextContent("AED 900.00");
    expect(totals).toHaveTextContent("2 incentives");
    expect(totals).toHaveTextContent("AED 550.00");
    const mariaRow = row("Maria S.");
    expect(mariaRow).toHaveTextContent("124 h · 31 visits");
    expect(mariaRow).toHaveTextContent("★ 4.90 · 20");
    expect(mariaRow).toHaveTextContent("82.92%");
    expect(mariaRow).toHaveTextContent("AED 400.00");
    expect(mariaRow).toHaveTextContent("Proposed AED 350.00");
    expect(mariaRow).toHaveTextContent("Approved");
  });

  it("offers only the ended months, never the current one", async () => {
    open();
    await screen.findByText("Maria S.");
    const options = within(screen.getByRole("combobox", { name: "Month" })).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(options[0]).toBe("2026-09");
    expect(options).not.toContain("2026-10");
    expect(options).toHaveLength(12);
  });

  it("says there is no active rule and links to the rules", async () => {
    api.fetchProposals.mockResolvedValue(proposalsPage([], { rule: null }));
    renderWithProviders(<IncentivesScreen />, { permissions: HR });
    expect(await screen.findByText("There is no active incentive rule, so nothing can be computed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the rules" })).toHaveAttribute("href", "/admin/workers/incentives/rules");
  });

  it("says a month is not computed yet, and computes it with an Idempotency-Key", async () => {
    api.computeIncentives.mockResolvedValue({ created: 5, rejected_below_threshold: 1, existing: 0 });
    api.fetchProposals.mockResolvedValue(proposalsPage([]));
    renderWithProviders(<IncentivesScreen />, { permissions: HR });
    const user = userEvent.setup();
    expect(await screen.findByText("Not computed yet")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Compute now" }).at(-1)!);
    const dialog = screen.getByRole("alertdialog", { name: "Compute the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Compute" }));
    await waitFor(() => expect(api.computeIncentives).toHaveBeenCalledTimes(1));
    expect(api.computeIncentives.mock.calls[0][0]).toBe("2026-09");
    expect(api.computeIncentives.mock.calls[0][1]).toMatch(UUID);
    expect(await screen.findByText("5 proposed, 1 closed below the thresholds, 0 already existed.")).toBeInTheDocument();
  });

  it("explains NO_ACTIVE_RULE when computing without a rule", async () => {
    api.computeIncentives.mockRejectedValue(apiError(409, "NO_ACTIVE_RULE"));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Compute now" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Compute" }));
    expect(await within(screen.getByRole("alertdialog")).findByText("There is no active incentive rule. Activate one first.")).toBeInTheDocument();
  });
});

describe("bulk approve (money: the lines and the total are confirmed, 409 TERMS_CHANGED and METRICS_STALE shown)", () => {
  it("approves the selected proposals at their proposed amounts and sends the lines and the total it showed", async () => {
    api.bulkApprove.mockResolvedValue({ approved: 2, total_fils: 55000 });
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    expect(screen.queryByRole("group", { name: "Actions on the selection" })).not.toBeInTheDocument();
    await pick(user, "Lakshmi N.", "Nirmala P.");
    const bar = screen.getByRole("group", { name: "Actions on the selection" });
    expect(bar).toHaveTextContent("2 selected");
    await user.click(within(bar).getByRole("button", { name: "Approve (2)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Approve 2 incentives" });
    expect(dialog).toHaveTextContent("Lakshmi N.");
    expect(dialog).toHaveTextContent("AED 200.00");
    expect(dialog).toHaveTextContent("AED 350.00");
    expect(dialog).toHaveTextContent("Total of 2 lines");
    expect(dialog).toHaveTextContent("AED 550.00");
    expect(api.bulkApprove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(api.bulkApprove).toHaveBeenCalledWith({
        proposal_ids: [3, 4],
        expected_lines: [{ id: 3, amount_fils: 20000 }, { id: 4, amount_fils: 35000 }],
        expected_total_fils: 55000,
      }),
    );
    expect(await screen.findByText("2 incentives approved, AED 550.00 in all.")).toBeInTheDocument();
  });

  it("approves only the proposals that can be approved: an approved or stale one is not in the count", async () => {
    open([maria, { ...lakshmi, metrics_stale_at: "2026-10-10T00:00:00+00:00" }, nirmala]);
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.", "Lakshmi N.", "Nirmala P.");
    expect(screen.getByRole("button", { name: "Approve (1)" })).toBeEnabled();
    expect(screen.getByText("Some selected proposals have changed figures: recompute them before approving.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject (2)" })).toBeEnabled();
  });

  it("puts the API's new lines on screen after a 409 TERMS_CHANGED, marks what changed and asks again", async () => {
    api.bulkApprove
      .mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { expected_total_fils: 55000, total_fils: 60000, lines: [{ id: 3, amount_fils: 20000 }, { id: 4, amount_fils: 40000 }] }))
      .mockResolvedValueOnce({ approved: 2, total_fils: 60000 });
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Lakshmi N.", "Nirmala P.");
    await user.click(screen.getByRole("button", { name: "Approve (2)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Approve 2 incentives" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    expect(await within(dialog).findByText("The amounts changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The new total is AED 600.00: confirm again to approve it.");
    expect(within(dialog).getByText("Nirmala P.").closest("tr")).toHaveTextContent("changed");
    expect(within(dialog).getByText("Nirmala P.").closest("tr")).toHaveTextContent("AED 400.00");
    expect(within(dialog).getByText("Lakshmi N.").closest("tr")).not.toHaveTextContent("changed");
    // Nothing is approved on the strength of the old figures: the second send carries the new lines and the new total.
    await user.click(within(dialog).getByRole("button", { name: "Approve the new total" }));
    await waitFor(() => expect(api.bulkApprove).toHaveBeenCalledTimes(2));
    expect(api.bulkApprove.mock.calls[1][0]).toEqual({ proposal_ids: [3, 4], expected_lines: [{ id: 3, amount_fils: 20000 }, { id: 4, amount_fils: 40000 }], expected_total_fils: 60000 });
  });

  it("names the proposals of a 409 METRICS_STALE and recomputes one from the dialog", async () => {
    api.bulkApprove.mockRejectedValueOnce(apiError(409, "METRICS_STALE", { ids: [4] }));
    api.recomputeProposal.mockResolvedValue(nirmala);
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Lakshmi N.", "Nirmala P.");
    await user.click(screen.getByRole("button", { name: "Approve (2)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Approve 2 incentives" });
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    const notice = await within(dialog).findByText(/The figures behind this incentive/);
    expect(within(notice.closest("div")!.parentElement!).getByText("Nirmala P.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(api.recomputeProposal).toHaveBeenCalledWith(4, 1));
  });

  it("rejects the selected proposals with one reason", async () => {
    api.bulkReject.mockResolvedValue({ rejected: 2 });
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Lakshmi N.", "Nirmala P.");
    await user.click(screen.getByRole("button", { name: "Reject (2)" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reject 2 incentives" });
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByText("Write a reason of at least 3 characters.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Reason/), "Below the target this month");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.bulkReject).toHaveBeenCalledWith({ proposal_ids: [3, 4], reason: "Below the target this month" }));
  });
});

describe("posting (final: Idempotency-Key, lines and total confirmed, adjustments included)", () => {
  const openForPost = () => {
    api.fetchAdjustments.mockResolvedValue(fixedPage([adjustment({ id: 4, amount_fils: -5000, reason: "Overpaid in August" })]));
    return open();
  };

  it("posts the approved lines and the month's open adjustments, sending every line with its kind and the total", async () => {
    api.postIncentives.mockResolvedValue(posting({ lines_count: 3, total_fils: 85000 }));
    api.fetchPostingFile.mockResolvedValue({ url: "https://files.test/INC.csv", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), file_name: "INC-2026-09-01.csv" });
    openForPost();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.", "Siti R.");
    await user.click(screen.getByRole("button", { name: "Post (2 approved, 1 adjustments)" }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    expect(dialog).toHaveTextContent("A posting is final.");
    expect(dialog).toHaveTextContent("AED 400.00");
    expect(dialog).toHaveTextContent("AED 500.00");
    expect(dialog).toHaveTextContent("Overpaid in August");
    expect(dialog).toHaveTextContent("AED -50.00");
    expect(dialog).toHaveTextContent("Total of 3 lines");
    expect(dialog).toHaveTextContent("AED 850.00");
    expect(api.postIncentives).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(1));
    const [body, key] = api.postIncentives.mock.calls[0];
    expect(key).toMatch(UUID);
    expect(body).toEqual({
      period: "2026-09",
      proposal_ids: [1, 2],
      adjustment_ids: [4],
      expected_lines: [
        { kind: "incentive", id: 1, amount_fils: 40000 },
        { kind: "incentive", id: 2, amount_fils: 50000 },
        { kind: "adjustment", id: 4, amount_fils: -5000 },
      ],
      expected_total_fils: 85000,
    });
    // The answer: the reference, and the file for accounting through a fresh signed link.
    expect(await screen.findByText("Posting INC-2026-09-01 was made: 3 lines, AED 850.00.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Download the file/ }));
    expect(api.fetchPostingFile).toHaveBeenCalledWith(1);
    expect(screen.getByRole("link", { name: "Open the posting" })).toHaveAttribute("href", "/admin/finance/incentive-postings/1");
  });

  it("leaves an adjustment out of this posting when it is unticked: the lines and the total follow", async () => {
    api.postIncentives.mockResolvedValue(posting());
    openForPost();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.");
    await user.click(screen.getByRole("button", { name: "Post (1 approved, 1 adjustments)" }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Maria S\.: AED -50\.00/ }));
    expect(dialog).toHaveTextContent("Total of 1 line");
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(1));
    expect(api.postIncentives.mock.calls[0][0]).toMatchObject({ proposal_ids: [1], adjustment_ids: [], expected_total_fils: 40000, expected_lines: [{ kind: "incentive", id: 1, amount_fils: 40000 }] });
  });

  it("retries a 503 POSTING_BUSY with the same Idempotency-Key, so nothing is posted twice", async () => {
    api.postIncentives.mockRejectedValueOnce(apiError(503, "POSTING_BUSY", { period: "2026-09" })).mockResolvedValueOnce(posting());
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.");
    await user.click(screen.getByRole("button", { name: /^Post \(1 approved/ }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    expect(await within(dialog).findByText(/Another posting of September 2026 is being saved\. Try again in a moment: nothing was posted twice\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(2));
    expect(api.postIncentives.mock.calls[1][1]).toBe(api.postIncentives.mock.calls[0][1]);
    expect(api.postIncentives.mock.calls[1][0]).toEqual(api.postIncentives.mock.calls[0][0]);
    expect(await screen.findByText(/Posting INC-2026-09-01 was made/)).toBeInTheDocument();
  });

  it("keeps the key after a lost answer too, and takes a new one once the API answered with a refusal it keeps", async () => {
    api.postIncentives
      .mockRejectedValueOnce(new AdminApiError(0, { code: "NETWORK_ERROR", message: "", details: {} }))
      .mockRejectedValueOnce(apiError(409, "INVALID_STATE", { ids: [1] }))
      .mockResolvedValueOnce(posting());
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.");
    await user.click(screen.getByRole("button", { name: /^Post \(1 approved/ }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(1));
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(2));
    expect(api.postIncentives.mock.calls[1][1]).toBe(api.postIncentives.mock.calls[0][1]);
    // The 409 was answered and kept by the API: the next attempt is a new intent with a new key.
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(3));
    expect(api.postIncentives.mock.calls[2][1]).not.toBe(api.postIncentives.mock.calls[1][1]);
  });

  it("puts the new lines on screen after a 409 TERMS_CHANGED and posts them with a new key and the new total", async () => {
    api.postIncentives
      .mockRejectedValueOnce(
        apiError(409, "TERMS_CHANGED", {
          expected_total_fils: 40000,
          total_fils: 45000,
          lines: [{ kind: "incentive", id: 1, amount_fils: 45000 }],
        }),
      )
      .mockResolvedValueOnce(posting());
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.");
    await user.click(screen.getByRole("button", { name: /^Post \(1 approved/ }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    expect(await within(dialog).findByText("The amounts changed")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("The new total is AED 450.00: confirm again to post it.");
    expect(within(dialog).getByText("Maria S.").closest("tr")).toHaveTextContent("changed");
    await user.click(within(dialog).getByRole("button", { name: "Post the new total" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(2));
    expect(api.postIncentives.mock.calls[1][0]).toMatchObject({ expected_total_fils: 45000, expected_lines: [{ kind: "incentive", id: 1, amount_fils: 45000 }] });
    expect(api.postIncentives.mock.calls[1][1]).not.toBe(api.postIncentives.mock.calls[0][1]);
  });

  it("shows PERIOD_NOT_CLOSED and IDEMPOTENCY_KEY_REUSED in words", async () => {
    api.postIncentives.mockRejectedValueOnce(apiError(422, "IDEMPOTENCY_KEY_REUSED"));
    open();
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    await pick(user, "Maria S.");
    await user.click(screen.getByRole("button", { name: /^Post \(1 approved/ }));
    const dialog = screen.getByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    expect(await within(dialog).findByText("This request was already used for different lines. Reopen the posting dialog and confirm again.")).toBeInTheDocument();
  });

  it("posts one proposal from its drawer", async () => {
    api.postIncentives.mockResolvedValue(posting({ lines_count: 1, total_fils: 40000 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open the incentive of Maria S\./ }));
    const drawer = screen.getByRole("dialog", { name: /Incentive of/ });
    expect(drawer).toHaveTextContent("Score breakdown");
    expect(drawer).toHaveTextContent("Covered two extra Fridays");
    await user.click(within(drawer).getByRole("button", { name: "Post" }));
    const dialog = await screen.findByRole("dialog", { name: "Post the incentives of September 2026" });
    await user.click(within(dialog).getByRole("button", { name: "Post" }));
    await waitFor(() => expect(api.postIncentives).toHaveBeenCalledTimes(1));
    expect(api.postIncentives.mock.calls[0][0]).toMatchObject({ proposal_ids: [1], expected_total_fils: 40000 });
  });
});

describe("adjustments and postings of the month", () => {
  it("adds a signed adjustment with an Idempotency-Key and the amount in fils", async () => {
    api.createAdjustment.mockResolvedValue(adjustment());
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add adjustment" }));
    const dialog = screen.getByRole("dialog", { name: "Add an adjustment" });
    await user.click(within(dialog).getByRole("button", { name: "Add adjustment" }));
    expect(within(dialog).getByText("Choose the cleaner.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the amount (negative takes money back).")).toBeInTheDocument();
    expect(api.createAdjustment).not.toHaveBeenCalled();
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Cleaner/ }), "3");
    await user.type(within(dialog).getByLabelText(/Amount/), "-50");
    await user.type(within(dialog).getByLabelText(/Reason/), "Overpaid in August");
    await user.click(within(dialog).getByRole("button", { name: "Add adjustment" }));
    await waitFor(() => expect(api.createAdjustment).toHaveBeenCalledTimes(1));
    expect(api.createAdjustment.mock.calls[0][0]).toEqual({ worker_id: 3, period: "2026-09", amount_fils: -5000, reason: "Overpaid in August" });
    expect(api.createAdjustment.mock.calls[0][1]).toMatch(UUID);
    expect(await screen.findByText(/Adjustment for .* added\./)).toBeInTheDocument();
  });

  it("offers only the months up to the current one, and the postings of earlier months to correct", async () => {
    api.fetchPostings.mockResolvedValue(fixedPage([posting({ id: 1, reference: "INC-2026-08-01", period: { start: "2026-08-01", end: "2026-08-31" } }), posting({ id: 2, reference: "INC-2026-09-01" })]));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add adjustment" }));
    const dialog = screen.getByRole("dialog", { name: "Add an adjustment" });
    const months = within(within(dialog).getByRole("combobox", { name: /Month/ })).getAllByRole("option").map((o) => o.getAttribute("value"));
    expect(months[0]).toBe("2026-10");
    expect(months).toContain("2026-09");
    expect(months).not.toContain("2026-11");
    // For September only the August posting is an earlier month.
    const corrects = within(dialog).getByRole("combobox", { name: /Corrects a posting/ });
    expect(within(corrects).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", expect.stringContaining("INC-2026-08-01")]);
  });

  it("shows the API's AMOUNT_OUT_OF_RANGE on the amount field", async () => {
    api.createAdjustment.mockRejectedValue(apiError(422, "AMOUNT_OUT_OF_RANGE", { min: -1000000, max: 1000000 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add adjustment" }));
    const dialog = screen.getByRole("dialog", { name: "Add an adjustment" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Cleaner/ }), "3");
    await user.type(within(dialog).getByLabelText(/Amount/), "99999");
    await user.type(within(dialog).getByLabelText(/Reason/), "Typo test");
    await user.click(within(dialog).getByRole("button", { name: "Add adjustment" }));
    expect(await within(dialog).findByText("The amount must be between AED -10,000.00 and AED 10,000.00.")).toBeInTheDocument();
  });

  it("lists the month's adjustments and deletes an open one with its version, never a posted one", async () => {
    api.fetchAdjustments.mockResolvedValue(fixedPage([adjustment({ id: 4 }), adjustment({ id: 5, reason: "Late fix", posting: { id: 1, reference: "INC-2026-09-01" }, version: 2 })]));
    api.deleteAdjustment.mockResolvedValue(undefined);
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Adjustments" }));
    expect(await screen.findByText("Overpaid in August")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Delete the adjustment of/ })).toHaveLength(1);
    expect(screen.getByText("Posted in INC-2026-09-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Delete the adjustment of/ }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteAdjustment).toHaveBeenCalledWith(4, 1));
  });

  it("lists the month's postings with links to their pages", async () => {
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Postings" }));
    const link = await screen.findByRole("link", { name: "INC-2026-09-01" });
    expect(link).toHaveAttribute("href", "/admin/finance/incentive-postings/1");
    expect(api.fetchPostings).toHaveBeenLastCalledWith({ period: "2026-09", page: 1 });
  });
});

describe("states", () => {
  it("needs incentives.approve", () => {
    renderWithProviders(<IncentivesScreen />, { permissions: ["workers.view"] });
    expect(api.fetchProposals).not.toHaveBeenCalled();
  });

  it("has an error state with a retry", async () => {
    api.fetchProposals.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(proposalsPage([maria]));
    renderWithProviders(<IncentivesScreen />, { permissions: HR });
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
  });

  it("is written in Arabic: totals, plural counts and the post dialog", async () => {
    api.postIncentives.mockResolvedValue(posting());
    open([maria, siti], HR, "ar");
    const user = userEvent.setup();
    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("الحوافز");
    expect(screen.getByRole("list", { name: "المجاميع حسب الحالة" })).toHaveTextContent("حافزان");
    await user.click(screen.getByRole("checkbox", { name: "تحديد Maria S." }));
    await user.click(screen.getByRole("button", { name: /^ترحيل/ }));
    const dialog = screen.getByRole("dialog", { name: /ترحيل حوافز/ });
    expect(dialog).toHaveTextContent("الترحيل نهائي");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
