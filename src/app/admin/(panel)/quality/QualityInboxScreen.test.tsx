import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { casesPage, caseDetail, caseRow } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { QualityInboxScreen } from "./QualityInboxScreen";

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

  it("an accountant reads the inbox but cannot take a case", async () => {
    renderWithProviders(<QualityInboxScreen />, { permissions: ACCOUNTANT });
    await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(screen.queryByRole("button", { name: /^Take/ })).toBeNull();
    expect(api.fetchAssignees).not.toHaveBeenCalled();
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

  it("opens the case beside the list on a wide screen, and closes again", async () => {
    wide(true);
    api.fetchCase.mockResolvedValue(caseDetail());
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    await userEvent.click(await screen.findByRole("link", { name: "Open case TC-4XQ8NM" }));
    const pane = await screen.findByRole("complementary", { name: "Case" });
    expect(await within(pane).findByText("The second bathroom was not cleaned at all.")).toBeInTheDocument();
    await userEvent.click(within(pane).getByRole("button", { name: "Close the side panel" }));
    expect(screen.queryByRole("complementary", { name: "Case" })).toBeNull();
  });

  it("follows the link to the case's own page on a narrow screen", async () => {
    wide(false);
    renderWithProviders(<QualityInboxScreen />, { permissions: COORDINATOR });
    const link = await screen.findByRole("link", { name: "Open case TC-4XQ8NM" });
    expect(link).toHaveAttribute("href", "/admin/quality/7");
    expect(screen.queryByRole("complementary", { name: "Case" })).toBeNull();
  });
});
