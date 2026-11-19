import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import { casesPage, caseDetail, caseRow } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { INBOX_REFRESH_MS, QualityInboxScreen } from "./QualityInboxScreen";

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
    usePathname: () => "/admin/quality",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = vi.hoisted(() => ({ fetchCases: vi.fn(), fetchCase: vi.fn(), fetchAssignees: vi.fn(), updateCase: vi.fn() }));
vi.mock("@/lib/admin/quality/endpoints", () => api);
vi.mock("@/lib/admin/endpoints", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/endpoints")>()),
  fetchZoneOptions: async () => [{ id: 1, code: "BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true }],
}));

const COORDINATOR = ["complaints.manage", "bookings.view"];
const ACCOUNTANT = ["compensation.approve", "refunds.create"];
const apiError = (status: number, code: string) => new AdminApiError(status, { code, message: "x", details: {} });
const rowOf = (reference: string) => screen.getByRole("link", { name: `Open case ${reference}` }).closest("tr")!;
const rowOf_ = (link: HTMLElement) => link.closest("tr")!;

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchCases.mockResolvedValue(
    casesPage(
      [
        caseRow(),
        caseRow({
          id: 8,
          reference: "TC-9ZZ1AB",
          type: "rating_followup",
          type_label: { ar: "تقييم منخفض", en: "Low rating" },
          rating: { overall: 2 },
          priority: "medium",
          priority_label: { ar: "متوسطة", en: "Medium" },
          status: "open",
          status_label: { ar: "مفتوحة", en: "Open" },
          assignee: { id: 4, name: "Omar" },
          customer_replied: true,
          awaiting_approval: true,
          sla: { state: "breached", kind: "first_response", due_at: "2026-10-23T14:00:00+00:00", remaining_minutes: -120 },
        }),
      ],
      { counts: { active: 14, unassigned: 3, breached: 2, awaiting_approval: 1 } },
    ),
  );
  api.fetchAssignees.mockResolvedValue([
    { id: 1, name: "Test Admin", roles: ["booking_coordinator"] },
    { id: 4, name: "Omar", roles: ["operations_coordinator"] },
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe("the A10 inbox", () => {
  it("lists every kind of case with its type, priority, status, assignee and deadline", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const first = within(await screen.findByRole("link", { name: "Open case TC-4XQ8NM" }).then((l) => l.closest("tr")!));
    expect(first.getByText("Complaint · Cleaning quality")).toBeInTheDocument();
    expect(first.getByText("Laila H.")).toBeInTheDocument();
    expect(first.getByText("High")).toBeInTheDocument();
    expect(first.getByText("In review")).toBeInTheDocument();
    expect(first.getByText("Nobody yet")).toBeInTheDocument();
    expect(first.getAllByText("3 h left").length).toBeGreaterThan(0);
    const second = within(rowOf("TC-9ZZ1AB"));
    expect(second.getByText("Low rating")).toBeInTheDocument();
    expect(second.getByRole("img", { name: "2 out of 5" })).toBeInTheDocument();
    expect(second.getByText("Omar")).toBeInTheDocument();
    expect(second.getByText("Customer replied")).toBeInTheDocument();
    expect(second.getByText("Compensation waiting")).toBeInTheDocument();
    expect(second.getAllByText("2 h overdue").length).toBeGreaterThan(0);
  });

  it("shows the counts as shortcuts that set the filters", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    const shortcuts = within(await screen.findByRole("list", { name: "Shortcuts" }));
    expect(shortcuts.getByRole("button", { name: /Active\s*14/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(shortcuts.getByRole("button", { name: /Unassigned\s*3/ }));
    await waitFor(() => expect(api.fetchCases).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: "unassigned" })));
    expect(url.get().get("assignee")).toBe("unassigned");
    await userEvent.click(shortcuts.getByRole("button", { name: /Overdue\s*2/ }));
    await waitFor(() => expect(api.fetchCases).toHaveBeenLastCalledWith(expect.objectContaining({ sla: "breached" })));
  });

  it("asks the API for what the URL says, in the API's own words, and ignores what it cannot read", async () => {
    url.set("status=resolved&priority=urgent&category=billing&sla=breached&customer_replied=1&sort=created&type=bogus");
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    await waitFor(() => expect(api.fetchCases).toHaveBeenCalled());
    expect(api.fetchCases.mock.calls[0][0]).toMatchObject({ status: ["resolved"], priority: "urgent", category: "billing", sla: "breached", customerReplied: true, sort: "created", type: undefined, page: 1, perPage: 25 });
  });

  it("changes a filter with its own select and keeps it in the URL", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    await userEvent.selectOptions(await screen.findByLabelText("Status"), "all");
    await waitFor(() => expect(api.fetchCases).toHaveBeenLastCalledWith(expect.objectContaining({ status: ["open", "in_review", "awaiting_customer", "resolved", "closed"] })));
    expect(url.get().get("status")).toBe("all");
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "me");
    await waitFor(() => expect(api.fetchCases).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: "me" })));
  });

  it("says when nothing is there, and when the filters found nothing", async () => {
    api.fetchCases.mockResolvedValue(casesPage([]));
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    expect(await screen.findByText("No cases")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "urgent");
    expect(await screen.findByText("No cases match these filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("No cases")).toBeInTheDocument();
  });

  it("offers a retry when the list fails, and the permission-denied page for a 403", async () => {
    api.fetchCases.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    const { unmount } = renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const retry = await screen.findByRole("button", { name: "Try again" });
    await userEvent.click(retry);
    expect(await screen.findByRole("link", { name: "Open case TC-4XQ8NM" })).toBeInTheDocument();
    unmount();
    api.fetchCases.mockRejectedValue(apiError(403, "FORBIDDEN"));
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    expect(await screen.findByText(/access/i)).toBeInTheDocument();
  });

  it("shows nothing but the page-denied note to staff without either permission", () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: ["bookings.view"] });
    expect(screen.queryByRole("table")).toBeNull();
    expect(api.fetchCases).not.toHaveBeenCalled();
  });

  it("lists a team's cleaners with the separator of the page's language", async () => {
    api.fetchCases.mockResolvedValue(casesPage([caseRow({ workers: [{ id: 1, name: "Maria S." }, { id: 4, name: "Joy R." }] })]));
    const { unmount } = renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    expect(within(rowOf_(await screen.findByRole("link", { name: "Open case TC-4XQ8NM" }))).getByText("Maria S., Joy R.")).toBeInTheDocument();
    unmount();
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR, locale: "ar" });
    expect(within(rowOf_(await screen.findByRole("link", { name: "فتح الحالة TC-4XQ8NM" }))).getByText("Maria S.، Joy R.")).toBeInTheDocument();
  });

  it("an accountant reads the inbox but cannot take a case", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: ACCOUNTANT });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    expect(api.fetchAssignees).not.toHaveBeenCalled();
  });
});

describe("the timed refresh", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("re-reads the inbox every 20 seconds as a background poll, with the same filters, and shows what came in", async () => {
    expect(INBOX_REFRESH_MS).toBe(20_000);
    url.set("priority=high");
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(api.fetchCases).toHaveBeenCalledTimes(1);
    expect(api.fetchCases.mock.calls[0]).toHaveLength(1);

    api.fetchCases.mockResolvedValue(casesPage([caseRow(), caseRow({ id: 9, reference: "TC-NEW001" })]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(await screen.findByRole("link", { name: "Open case TC-NEW001" })).toBeInTheDocument();
    expect(api.fetchCases).toHaveBeenCalledTimes(2);
    expect(api.fetchCases.mock.calls[1]).toEqual([api.fetchCases.mock.calls[0][0], { background: true }]);
    expect(api.fetchCases.mock.calls[1][0]).toMatchObject({ priority: "high" });
  });
});

describe("taking a case", () => {
  it("reads the case first and assigns it with the version it read as If-Match", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    api.fetchCase.mockResolvedValue(caseDetail({ version: 9 }));
    api.updateCase.mockResolvedValue(caseDetail({ version: 10, assignee: { id: 1, name: "Test Admin" } }));
    await userEvent.click(await screen.findByRole("button", { name: "Take case TC-4XQ8NM" }));
    await waitFor(() => expect(api.updateCase).toHaveBeenCalledWith(7, { assignee_id: 1 }, 9));
    expect(await screen.findByText("TC-4XQ8NM is yours")).toBeInTheDocument();
    // Only an unassigned case has the button.
    expect(screen.queryByRole("button", { name: "Take case TC-9ZZ1AB" })).toBeNull();
  });

  it("does not take it from somebody who got there first, and says who", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    api.fetchCase.mockResolvedValue(caseDetail({ assignee: { id: 4, name: "Omar" } }));
    await userEvent.click(await screen.findByRole("button", { name: "Take case TC-4XQ8NM" }));
    expect(await screen.findByText("TC-4XQ8NM was just taken by Omar")).toBeInTheDocument();
    expect(api.updateCase).not.toHaveBeenCalled();
  });
});

describe("the side pane", () => {
  const wide = (matches: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  afterEach(() => vi.unstubAllGlobals());

  /** Case 7 (TC-4XQ8NM) and case 8 (TC-9ZZ1AB), each read by its own number. */
  const twoCases = () =>
    api.fetchCase.mockImplementation(async (id: number) =>
      id === 8 ? caseDetail({ id: 8, reference: "TC-9ZZ1AB", description: "The cleaner left early.", messages: [] }) : caseDetail(),
    );

  it("opens the case beside the list on a wide screen, moves focus to it, and gives it back to the row on close", async () => {
    wide(true);
    api.fetchCase.mockResolvedValue(caseDetail());
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const link = await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    await userEvent.click(link);
    const pane = await screen.findByRole("complementary", { name: "Case TC-4XQ8NM" });
    // Keyboard and screen-reader users land on the pane, which is named by its case.
    expect(pane).toHaveFocus();
    expect(await within(pane).findByText("The second bathroom was not cleaned at all.")).toBeInTheDocument();
    // The pane's title sits under the page's own: one h1 on the page.
    expect(within(pane).getByRole("heading", { level: 2, name: /TC-4XQ8NM/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(link).toHaveAttribute("aria-current", "true");
    await userEvent.click(within(pane).getByRole("button", { name: "Close the side panel" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(link).toHaveFocus();
  });

  it("starts every case afresh: nothing chosen on one case is carried to the next, even when that one is already read", async () => {
    wide(true);
    twoCases();
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    // Both cases read once, so the second visit to case 8 comes from the cache.
    await userEvent.click(await screen.findByRole("link", { name: "Open case TC-9ZZ1AB" }));
    expect(await within(await screen.findByRole("complementary", { name: "Case TC-9ZZ1AB" })).findByText("The cleaner left early.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Open case TC-4XQ8NM" }));
    const first = await screen.findByRole("complementary", { name: "Case TC-4XQ8NM" });
    await userEvent.click(await within(first).findByRole("radio", { name: "Internal note" }));
    expect(within(first).getByRole("radio", { name: "Internal note" })).toBeChecked();

    await userEvent.click(screen.getByRole("link", { name: "Open case TC-9ZZ1AB" }));
    const second = await screen.findByRole("complementary", { name: "Case TC-9ZZ1AB" });
    expect(within(second).getByText("The cleaner left early.")).toBeInTheDocument();
    expect(within(second).getByRole("radio", { name: "Reply to the customer" })).toBeChecked();
    expect(second).toHaveFocus();
  });

  it("never moves a reply being written to another case: the guard asks, and leaving opens that case's own page", async () => {
    wide(true);
    twoCases();
    const push = vi.fn();
    renderWithProviders(
      <UnsavedChangesProvider navigate={push}>
        <QualityInboxScreen />
      </UnsavedChangesProvider>,
      { permissions: COORDINATOR },
    );
    await userEvent.click(await screen.findByRole("link", { name: "Open case TC-4XQ8NM" }));
    const pane = await screen.findByRole("complementary", { name: "Case TC-4XQ8NM" });
    await userEvent.type(await within(pane).findByLabelText(/Your reply/), "Which room was it?");

    await userEvent.click(screen.getByRole("link", { name: "Open case TC-9ZZ1AB" }));
    const ask = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    await userEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    // Still case 7, with its draft.
    expect(screen.getByRole("complementary", { name: "Case TC-4XQ8NM" })).toBe(pane);
    expect(within(pane).getByLabelText(/Your reply/)).toHaveValue("Which room was it?");
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("link", { name: "Open case TC-9ZZ1AB" }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).getByRole("button", { name: "Leave without saving" }));
    expect(push).toHaveBeenCalledWith("/admin/quality/8");
    expect(api.fetchCase).not.toHaveBeenCalledWith(8);
  });

  it("asks before closing the pane over an unsent reply", async () => {
    wide(true);
    api.fetchCase.mockResolvedValue(caseDetail());
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const link = await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    await userEvent.click(link);
    const pane = await screen.findByRole("complementary", { name: "Case TC-4XQ8NM" });
    await userEvent.type(await within(pane).findByLabelText(/Your reply/), "Which room was it?");

    await userEvent.click(within(pane).getByRole("button", { name: "Close the side panel" }));
    const ask = await screen.findByRole("alertdialog", { name: "Close the case with an unsent reply?" });
    await userEvent.click(within(ask).getByRole("button", { name: "Keep writing" }));
    expect(within(pane).getByLabelText(/Your reply/)).toHaveValue("Which room was it?");

    await userEvent.click(within(pane).getByRole("button", { name: "Close the side panel" }));
    await userEvent.click(within(await screen.findByRole("alertdialog", { name: "Close the case with an unsent reply?" })).getByRole("button", { name: "Close and discard the reply" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    await waitFor(() => expect(link).toHaveFocus());

    // With nothing typed, the pane closes at once.
    await userEvent.click(link);
    await userEvent.click(within(await screen.findByRole("complementary", { name: "Case TC-4XQ8NM" })).getByRole("button", { name: "Close the side panel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("follows the link to the case's own page on a narrow screen", async () => {
    wide(false);
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const link = await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(link).toHaveAttribute("href", "/admin/quality/7");
    expect(screen.queryByRole("complementary", { name: "Case" })).toBeNull();
  });
});
