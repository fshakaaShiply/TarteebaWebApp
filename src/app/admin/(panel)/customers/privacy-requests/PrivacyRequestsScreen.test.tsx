import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { PrivacyPage, PrivacyRequest } from "@/lib/admin/customers/types";
import { CUSTOMER_ULID, privacyRequest } from "@/test/customerFixtures";
import { renderWithProviders } from "@/test/render";
import { PrivacyRequestsScreen } from "./PrivacyRequestsScreen";

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
    usePathname: () => "/admin/customers/privacy-requests",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = vi.hoisted(() => ({ fetchPrivacyRequests: vi.fn(), cancelPrivacyRequest: vi.fn(), retryPrivacyRequest: vi.fn() }));
vi.mock("@/lib/admin/customers/endpoints", () => api);

const STAFF = ["customers.privacy_requests", "customers.view"];
const counts = { received: 1, scheduled: 2, processing: 0, completed: 5, expired: 1, cancelled: 1, failed: 1 };
const page = (rows: PrivacyRequest[]): PrivacyPage => ({
  data: rows,
  meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1, counts_by_status: counts },
});
/** The row of the table holding `text` (the filters offer the same words as options, so the table is asked, not the page). */
async function rowWith(text: string) {
  const table = await screen.findByRole("table");
  return within((await within(table).findByText(text)).closest("tr")!);
}
const err = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchPrivacyRequests.mockResolvedValue(page([privacyRequest()]));
});
afterEach(() => vi.restoreAllMocks());

describe("A07 privacy queue", () => {
  it("opens on the open requests, with the day a deletion runs, what it waits on, and a link to the customer", async () => {
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    const row = await rowWith("Account deletion");
    expect(api.fetchPrivacyRequests.mock.calls[0][0]).toMatchObject({ status: "open", type: undefined, page: 1 });
    expect(row.getByText("Scheduled")).toBeInTheDocument();
    expect(row.getByText("a refund in progress")).toBeInTheDocument();
    expect(row.getByText(/Runs /)).toBeInTheDocument();
    expect(row.getByText("#21").parentElement).toHaveTextContent("#21 · From the app · Code in the app");
    expect(row.getByRole("link", { name: "Sara Ahmed" })).toHaveAttribute("href", `/admin/customers/${CUSTOMER_ULID}`);
    expect(row.getByText("Deletion pending")).toBeInTheDocument();
  });

  it("counts the requests by status and filters by the count buttons", async () => {
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    await rowWith("Account deletion");
    const group = screen.getByRole("group", { name: "Requests by status" });
    // Open = received + scheduled + processing + failed.
    expect(within(group).getByRole("button", { name: "Open (4)" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Failed (1)" })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: "Failed (1)" }));
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.lastCall?.[0]).toMatchObject({ status: "failed" }));
    expect(url.get().get("status")).toBe("failed");
    await userEvent.click(within(group).getByRole("button", { name: "Open (4)" }));
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.lastCall?.[0]).toMatchObject({ status: "open" }));
  });

  it("filters by type, status and search, and lists every status on request", async () => {
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    await rowWith("Account deletion");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "export");
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.lastCall?.[0]).toMatchObject({ type: "export" }));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.lastCall?.[0]).toMatchObject({ status: undefined, type: "export" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search requests" }), "sara");
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.lastCall?.[0]).toMatchObject({ q: "sara" }));
  });

  it("shows a failed request in danger with its reason and attempts, and offers a retry that sends its version", async () => {
    api.fetchPrivacyRequests.mockResolvedValue(
      page([
        privacyRequest({
          status: "failed",
          status_label: { ar: "فشل", en: "Failed" },
          failure_code: "eraser_failed",
          failure_label: { ar: "فشل محو جزء من البيانات", en: "erasing one part of the data failed" },
          attempts: 3,
          waiting_on: [],
          version: 8,
          actions: { cancel: false, retry: true },
        }),
      ]),
    );
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    const row = await rowWith("Account deletion");
    expect(row.getByText("Failed: erasing one part of the data failed (3 attempts)")).toBeInTheDocument();
    // Once erasure has begun the API offers no cancel: only a retry.
    expect(row.queryByRole("button", { name: /Cancel request/ })).toBeNull();
    api.retryPrivacyRequest.mockResolvedValue(privacyRequest());
    await userEvent.click(row.getByRole("button", { name: "Retry request #21" }));
    await waitFor(() => expect(api.retryPrivacyRequest).toHaveBeenCalledWith(21, 8));
    expect(await screen.findByText("The request will run again")).toBeInTheDocument();
  });

  it("shows a data copy with its downloads and how long the link lasts", async () => {
    api.fetchPrivacyRequests.mockResolvedValue(
      page([privacyRequest({ id: 22, type: "export", type_label: { ar: "نسخة من البيانات", en: "Data copy" }, status: "completed", status_label: { ar: "مكتمل", en: "Completed" }, waiting_on: [], scheduled_for: null, completed_at: "2026-11-10T08:00:00+00:00", export: { size_bytes: 2048, expires_at: "2026-11-17T08:00:00+00:00", download_count: 1, last_downloaded_at: null }, actions: { cancel: false, retry: false } })]),
    );
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    const row = await rowWith("Data copy");
    expect(row.getByText(/Downloaded 1 time · link until/)).toBeInTheDocument();
    expect(row.queryByRole("button")).toBeNull();
  });

  it("shows a deleted customer without a name and without a link", async () => {
    api.fetchPrivacyRequests.mockResolvedValue(page([privacyRequest({ customer: { id: CUSTOMER_ULID, name: null, phone: null, status: "deleted", status_label: { ar: "محذوف", en: "Deleted" } } })]));
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    const row = await rowWith("Account deletion");
    expect(row.getByText("Deleted customer")).toBeInTheDocument();
  });

  it("says nothing is open, and offers to clear a filter that matches nothing", async () => {
    api.fetchPrivacyRequests.mockResolvedValue(page([]));
    const { unmount } = renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    expect(await screen.findByText("No privacy requests are open")).toBeInTheDocument();
    unmount();
    url.set("type=export");
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    expect(await screen.findByText("No request matches")).toBeInTheDocument();
  });

  it("is denied without customers.privacy_requests, and shows a failed load with a retry", async () => {
    const { unmount } = renderWithProviders(<PrivacyRequestsScreen />, { permissions: ["customers.view"] });
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
    expect(api.fetchPrivacyRequests).not.toHaveBeenCalled();
    unmount();
    api.fetchPrivacyRequests.mockRejectedValueOnce(err(500, "SERVER_ERROR"));
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await rowWith("Account deletion")).toBeTruthy();
  });

  it("speaks Arabic with the API's labels and numbers in Latin", async () => {
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF, locale: "ar" });
    const row = await rowWith("حذف الحساب");
    expect(row.getByText("مجدول")).toBeInTheDocument();
    expect(row.getByText("استرداد قيد المعالجة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "المفتوحة (4)" })).toBeInTheDocument();
  });
});

describe("cancelling a request", () => {
  async function openCancel(row = privacyRequest()) {
    api.fetchPrivacyRequests.mockResolvedValue(page([row]));
    renderWithProviders(<PrivacyRequestsScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: `Cancel request #${row.id}` }));
    return screen.findByRole("alertdialog");
  }

  it("lists what the deletion already cancelled as not restored, asks for a reason, and sends it with the version", async () => {
    const dialog = await openCancel();
    expect(dialog).toHaveTextContent("The account comes back to what it was before the request.");
    expect(within(dialog).getByText("Cancelled by this request, not restored")).toBeInTheDocument();
    expect(within(dialog).getByText(/TRB-FZTVY8/).closest("li")).toHaveTextContent("fee AED 120.00, refund AED 120.00");
    expect(within(dialog).getByText(/TRS-7K2M9Q/).closest("li")).toHaveTextContent("fee AED 0.00, refund AED 600.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(await within(dialog).findByText("Write the reason.")).toBeInTheDocument();
    expect(api.cancelPrivacyRequest).not.toHaveBeenCalled();
    api.cancelPrivacyRequest.mockResolvedValue(privacyRequest({ status: "cancelled" }));
    await userEvent.type(within(dialog).getByLabelText(/Why it is cancelled/), "The customer called to stop it");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(api.cancelPrivacyRequest).toHaveBeenCalledWith(21, "The customer called to stop it", 3));
    expect(await screen.findByText("Request cancelled")).toBeInTheDocument();
  });

  it("has no not-restored list for a data copy", async () => {
    const dialog = await openCancel(privacyRequest({ id: 23, type: "export", type_label: { ar: "نسخة من البيانات", en: "Data copy" }, status: "received", impact_snapshot: null, waiting_on: [], scheduled_for: null }));
    expect(within(dialog).queryByText("Cancelled by this request, not restored")).toBeNull();
    expect(dialog).toHaveTextContent("No data copy will be prepared for this request.");
  });

  it("says so when erasure has begun meanwhile, and refreshes the queue", async () => {
    const dialog = await openCancel();
    api.cancelPrivacyRequest.mockRejectedValue(err(409, "ERASURE_STARTED", { processing_started_at: "2026-11-23T05:00:00+00:00" }));
    await userEvent.type(within(dialog).getByLabelText(/Why it is cancelled/), "Customer asked to stop it");
    const before = api.fetchPrivacyRequests.mock.calls.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(await within(dialog).findByText("The erasure has already started, so this request can no longer be cancelled.")).toBeInTheDocument();
    await waitFor(() => expect(api.fetchPrivacyRequests.mock.calls.length).toBeGreaterThan(before));
  });

  it("does not send a refused version again: the queue is read, and the next confirm carries the new version", async () => {
    const dialog = await openCancel();
    await userEvent.type(within(dialog).getByLabelText(/Why it is cancelled/), "Customer asked to stop it");
    api.cancelPrivacyRequest.mockRejectedValueOnce(err(409, "STALE_VERSION", { current_version: 4 }));
    api.fetchPrivacyRequests.mockResolvedValue(page([privacyRequest({ version: 4 })]));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    expect(await within(dialog).findByText("The customer changed")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByText(/The customer was read again/)).toBeInTheDocument());
    expect(api.cancelPrivacyRequest).toHaveBeenCalledTimes(1);
    api.cancelPrivacyRequest.mockResolvedValue(privacyRequest({ status: "cancelled" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(api.cancelPrivacyRequest).toHaveBeenCalledTimes(2));
    expect(api.cancelPrivacyRequest.mock.calls[0][2]).toBe(3);
    expect(api.cancelPrivacyRequest.mock.calls[1][2]).toBe(4);
  });
});
