import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { Compensation } from "@/lib/admin/quality/types";
import { caseDetail, compensation } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { CompensationsScreen, QUEUE_REFRESH_MS } from "./CompensationsScreen";

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
    usePathname: () => "/admin/quality/compensations",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = vi.hoisted(() => ({ fetchCompensations: vi.fn(), approveCompensation: vi.fn(), rejectCompensation: vi.fn() }));
vi.mock("@/lib/admin/quality/endpoints", () => api);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNTANT = ["compensation.approve", "refunds.create", "payments.view", "customers.view"];
const COORDINATOR = ["complaints.manage"];
const page = (rows: Compensation[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchCompensations.mockResolvedValue(page([compensation()]));
});
afterEach(() => vi.restoreAllMocks());

async function openApprove(perms: readonly string[] = ACCOUNTANT, row = compensation()) {
  api.fetchCompensations.mockResolvedValue(page([row]));
  renderWithProviders(<CompensationsScreen />, { permissions: perms });
  await userEvent.click(await screen.findByRole("button", { name: "Approve the compensation of case TC-4XQ8NM" }));
  return screen.findByRole("dialog");
}

describe("the accountant's queue", () => {
  it("lists what waits for approval, oldest first, with the case, the customer, the money and who proposed it", async () => {
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    const row = within((await screen.findByRole("link", { name: "Open case TC-4XQ8NM" })).closest("tr")!);
    expect(row.getByText("Refund · AED 30.00")).toBeInTheDocument();
    expect(row.getByText("To the card")).toBeInTheDocument();
    expect(row.getByText("Waiting for approval")).toBeInTheDocument();
    expect(row.getByText("Omar")).toBeInTheDocument();
    expect(row.getByText("“Half a room was missed.”")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Laila Hassan" })).toHaveAttribute("href", "/admin/customers/01JC0000000000000000000001");
    // The default is the API's own: no status asked for.
    expect(api.fetchCompensations.mock.calls[0][0]).toMatchObject({ status: undefined, page: 1 });
  });

  it("has a free visit's date instead of an amount", async () => {
    api.fetchCompensations.mockResolvedValue(
      page([compensation({ type: "free_visit", type_label: { ar: "زيارة تنظيف مجانية", en: "Free cleaning visit" }, amount_fils: 0, destination: null, status: "executed", status_label: { ar: "تم المنح", en: "Given" }, recovery_booking: { id: 31, reference: "TRB-FREE01", service_date: "2026-10-27", status: "confirmed" } })]),
    );
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    const row = within((await screen.findByRole("link", { name: "Open case TC-4XQ8NM" })).closest("tr")!);
    expect(row.getByText("Free cleaning visit")).toBeInTheDocument();
    expect(row.getByText(/TRB-FREE01/)).toBeInTheDocument();
    expect(row.getByText("Not at the customer yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
  });

  it("filters by state and kind in the URL, and lists every state on request", async () => {
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");
    await waitFor(() => expect(api.fetchCompensations.mock.lastCall?.[0].status).toHaveLength(5));
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "credit");
    await waitFor(() => expect(api.fetchCompensations.mock.lastCall?.[0]).toMatchObject({ type: "credit" }));
    expect(url.get().get("type")).toBe("credit");
  });

  it("says when nothing is waiting, and explains a failed compensation in words", async () => {
    api.fetchCompensations.mockResolvedValue(page([]));
    const { unmount } = renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    expect(await screen.findByText("Nothing is waiting for approval")).toBeInTheDocument();
    unmount();
    api.fetchCompensations.mockResolvedValue(page([compensation({ status: "failed", status_label: { ar: "تعذّر", en: "Failed" }, failure_code: "refund_failed_manual" })]));
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    expect(await screen.findByText("Finance recorded a refused refund")).toBeInTheDocument();
  });

  it("is read-only for the coordinator, who can still read the queue", async () => {
    renderWithProviders(<CompensationsScreen />, { permissions: COORDINATOR });
    expect(await screen.findByText(/Approving and rejecting are for the accountant/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Reject/ })).toBeNull();
  });
});

describe("approving", () => {
  it("shows the exact amount in a second step and sends it with the version, the key and the note", async () => {
    const dialog = await openApprove();
    api.approveCompensation.mockResolvedValue({ data: compensation({ status: "executed", version: 4 }), case: caseDetail() });
    expect(within(dialog).getByText("To the customer's card")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText("Note"), "Photos match");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Nothing goes out before the amount is confirmed.
    expect(api.approveCompensation).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/refund is sent to the payment provider now/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    await waitFor(() => expect(api.approveCompensation).toHaveBeenCalledTimes(1));
    expect(api.approveCompensation).toHaveBeenCalledWith(12, { expected_amount_fils: 3000, note: "Photos match" }, 3, expect.stringMatching(UUID));
    expect(await screen.findByText("Approved: AED 30.00 is on its way to the customer")).toBeInTheDocument();
  });

  it("will not confirm a refund without the refund permission, and says so", async () => {
    const dialog = await openApprove(["compensation.approve"]);
    expect(within(dialog).getByText(/You can approve compensations but not refunds/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("approves a balance credit with the credit's own words", async () => {
    const credit = compensation({ type: "credit", type_label: { ar: "رصيد", en: "Balance credit" }, destination: null, amount_fils: 5000 });
    const dialog = await openApprove(ACCOUNTANT, credit);
    api.approveCompensation.mockResolvedValue({ data: { ...credit, status: "executed" }, case: caseDetail() });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and add AED 50.00 to the balance" }));
    await waitFor(() => expect(api.approveCompensation).toHaveBeenCalledWith(12, { expected_amount_fils: 5000 }, 3, expect.any(String)));
    expect(await screen.findByText("Approved: AED 50.00 added to the customer's balance")).toBeInTheDocument();
  });

  it("puts the API's amount on screen after 409 TERMS_CHANGED, marks it and asks again with a new key", async () => {
    const dialog = await openApprove();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.approveCompensation
      .mockRejectedValueOnce(apiError(409, "TERMS_CHANGED", { compensation: { id: 12, type: "refund", amount_fils: 2000, version: 4 } }))
      .mockResolvedValue({ data: compensation({ status: "executed", amount_fils: 2000, version: 5 }), case: caseDetail() });
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    expect(await within(dialog).findByText("The amount changed")).toBeInTheDocument();
    expect(within(dialog).getByText("It was AED 30.00 and is now AED 20.00. Check the new amount before you confirm.")).toBeInTheDocument();
    // The second step now carries the new amount; nothing was resent by itself.
    expect(api.approveCompensation).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 20.00" }));
    await waitFor(() => expect(api.approveCompensation).toHaveBeenCalledTimes(2));
    expect(api.approveCompensation.mock.calls[1].slice(1, 3)).toEqual([{ expected_amount_fils: 2000 }, 4]);
    expect(api.approveCompensation.mock.calls[1][3]).not.toBe(api.approveCompensation.mock.calls[0][3]);
  });

  it("does not resend a refused version after STALE_VERSION: it shows the row as read again", async () => {
    const dialog = await openApprove();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.approveCompensation.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 4 })).mockResolvedValue({ data: compensation({ status: "executed", version: 5 }), case: caseDetail() });
    // The queue reads the compensation again with its new version and a changed note.
    api.fetchCompensations.mockResolvedValue(page([compensation({ version: 4, note: "Changed by the proposer" })]));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    expect(await within(dialog).findByText("The compensation changed meanwhile")).toBeInTheDocument();
    expect(await within(dialog).findByText("“Changed by the proposer”")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    await waitFor(() => expect(api.approveCompensation).toHaveBeenCalledTimes(2));
    expect(api.approveCompensation.mock.calls[0][2]).toBe(3);
    expect(api.approveCompensation.mock.calls[1][2]).toBe(4);
  });

  it("says it no longer applies when someone else decided it first", async () => {
    const dialog = await openApprove();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.approveCompensation.mockRejectedValue(apiError(409, "STALE_VERSION", { current_version: 4 }));
    api.fetchCompensations.mockResolvedValue(page([compensation({ version: 4, status: "executed", status_label: { ar: "تم المنح", en: "Given" } })]));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    expect(await within(dialog).findByText("This compensation is no longer waiting for approval.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("words the API's refusals, and keeps the key for a lost answer", async () => {
    const dialog = await openApprove();
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.approveCompensation.mockRejectedValueOnce(apiError(502, "BAD_GATEWAY")).mockRejectedValueOnce(apiError(409, "ACCOUNT_CLOSING"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    expect(await within(dialog).findByText("The approval may have gone through")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    expect(await within(dialog).findByText(/account is being closed/)).toBeInTheDocument();
    expect(api.approveCompensation.mock.calls[1][3]).toBe(api.approveCompensation.mock.calls[0][3]);
  });
});

describe("the timed refresh", () => {
  const seconds = (n: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(n * 1000);
    });
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("re-reads the queue every 20 seconds as a background poll, and shows what was proposed meanwhile", async () => {
    expect(QUEUE_REFRESH_MS).toBe(20_000);
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(api.fetchCompensations.mock.calls).toEqual([[expect.objectContaining({ page: 1 })]]);

    api.fetchCompensations.mockResolvedValue(page([compensation(), compensation({ id: 13, case: { id: 9, reference: "TC-NEW001", type: "complaint", category: "quality" } })]));
    await seconds(20);
    expect(await screen.findByRole("link", { name: "Open case TC-NEW001" })).toBeInTheDocument();
    expect(api.fetchCompensations).toHaveBeenCalledTimes(2);
    // The poll is marked as one, so it does not count as the accountant's activity.
    expect(api.fetchCompensations.mock.calls[1]).toEqual([api.fetchCompensations.mock.calls[0][0], { background: true }]);
  });

  it("a poll never changes an open approval: the dialog keeps the facts and the version it opened with", async () => {
    const dialog = await openApprove();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

    // The proposer changed the note meanwhile: the queue shows it, the open dialog does not.
    api.fetchCompensations.mockResolvedValue(page([compensation({ version: 4, note: "Changed by the proposer" })]));
    await seconds(20);
    await waitFor(() => expect(api.fetchCompensations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("“Changed by the proposer”")).toBeInTheDocument();
    expect(within(dialog).queryByText("“Changed by the proposer”")).toBeNull();
    expect(screen.getByRole("dialog")).toBe(dialog);

    api.approveCompensation.mockResolvedValue({ data: compensation({ status: "executed", version: 5 }), case: caseDetail() });
    await user.click(within(dialog).getByRole("button", { name: "Approve and refund AED 30.00" }));
    await waitFor(() => expect(api.approveCompensation).toHaveBeenCalledTimes(1));
    expect(api.approveCompensation.mock.calls[0][2]).toBe(3);
  });
});

describe("rejecting", () => {
  it("needs a reason of at least three characters and sends it with the version and a key", async () => {
    renderWithProviders(<CompensationsScreen />, { permissions: ACCOUNTANT });
    await userEvent.click(await screen.findByRole("button", { name: "Reject the compensation of case TC-4XQ8NM" }));
    const dialog = await screen.findByRole("dialog");
    api.rejectCompensation.mockResolvedValue(compensation({ status: "rejected" }));
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), "no");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(await within(dialog).findByText("The reason is too short (3 characters at least).")).toBeInTheDocument();
    expect(api.rejectCompensation).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), " proof");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.rejectCompensation).toHaveBeenCalledWith(12, "no proof", 3, expect.stringMatching(UUID)));
    expect(await screen.findByText("Compensation rejected")).toBeInTheDocument();
  });
});
