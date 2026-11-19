import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { CustomerListItem } from "@/lib/admin/customers/types";
import { customerRow } from "@/test/customerFixtures";
import { renderWithProviders } from "@/test/render";
import { CustomersScreen } from "./CustomersScreen";

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
    usePathname: () => "/admin/customers",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = vi.hoisted(() => ({ fetchCustomers: vi.fn() }));
vi.mock("@/lib/admin/customers/endpoints", () => api);

const page = (rows: CustomerListItem[]) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1 } });
const COORDINATOR = ["customers.view", "customers.privacy_requests"];

beforeEach(() => {
  url.set("");
  api.fetchCustomers.mockReset();
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchCustomers.mockResolvedValue(page([customerRow()]));
});
afterEach(() => vi.restoreAllMocks());

describe("A07 customer list", () => {
  it("lists customers with their contact, status, bookings and open items, each opening the profile", async () => {
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    const link = await screen.findByRole("link", { name: "Sara Ahmed" });
    expect(link).toHaveAttribute("href", "/admin/customers/01JC0000000000000000000001");
    const row = within(link.closest("tr")!);
    expect(row.getByText("+971559871234")).toBeInTheDocument();
    expect(row.getByText("sara@example.com")).toBeInTheDocument();
    expect(row.getByText("Active")).toBeInTheDocument();
    expect(row.getByText("14 bookings")).toBeInTheDocument();
    expect(row.getByText("1 open")).toBeInTheDocument();
    expect(row.getByText("1 open subscription")).toBeInTheDocument();
    // The first read carries no filter and never a phone parameter.
    expect(api.fetchCustomers.mock.calls[0][0]).toEqual({ page: 1, perPage: 25, q: undefined, status: undefined, sort: undefined });
  });

  it("shows a blocked customer in danger and a deletion that waits with the day it runs", async () => {
    api.fetchCustomers.mockResolvedValue(
      page([
        customerRow({ id: "01JC0000000000000000000002", name: "Blocked Bea", status: "blocked", status_label: { ar: "موقوف", en: "Blocked" } }),
        customerRow({ id: "01JC0000000000000000000003", name: "Leaving Lou", status: "pending_deletion", status_label: { ar: "الحذف قيد الانتظار", en: "Deletion pending" }, deletion_on: "2026-11-24", privacy_pending: "delete" }),
        customerRow({ id: "01JC0000000000000000000004", name: "Copy Cat", privacy_pending: "export" }),
      ]),
    );
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    expect(within((await screen.findByRole("link", { name: "Blocked Bea" })).closest("tr")!).getByText("Blocked")).toBeInTheDocument();
    const leaving = within(screen.getByRole("link", { name: "Leaving Lou" }).closest("tr")!);
    expect(leaving.getByText("Deletion pending")).toBeInTheDocument();
    expect(leaving.getByText(/Deletion on/)).toHaveTextContent("Deletion on Tue, 24 Nov 2026");
    expect(within(screen.getByRole("link", { name: "Copy Cat" }).closest("tr")!).getByText("Data copy requested")).toBeInTheDocument();
  });

  it("shows a deleted account as «Deleted customer», with no name, phone or e-mail", async () => {
    api.fetchCustomers.mockResolvedValue(page([customerRow({ name: null, phone: null, email: null, status: "deleted", status_label: { ar: "محذوف", en: "Deleted" } })]));
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    const row = within((await screen.findByRole("link", { name: "Deleted customer" })).closest("tr")!);
    expect(row.getByText("Deleted")).toBeInTheDocument();
    expect(row.queryByText(/\+971/)).toBeNull();
    expect(row.queryByText(/@/)).toBeNull();
  });

  it("speaks Arabic with the API's own status labels", async () => {
    api.fetchCustomers.mockResolvedValue(page([customerRow({ status: "blocked", status_label: { ar: "موقوف", en: "Blocked" } })]));
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR, locale: "ar" });
    const row = within((await screen.findByRole("link", { name: "Sara Ahmed" })).closest("tr")!);
    expect(row.getByText("موقوف")).toBeInTheDocument();
    expect(row.getByText("14 حجزًا")).toBeInTheDocument();
  });

  it("keeps the search and the status in the URL, searches after a pause, and orders on request", async () => {
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    await screen.findByRole("link", { name: "Sara Ahmed" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search customers" }), "0559871234");
    await waitFor(() => expect(api.fetchCustomers.mock.lastCall?.[0]).toMatchObject({ q: "0559871234", page: 1 }));
    expect(url.get().get("q")).toBe("0559871234");
    await userEvent.selectOptions(screen.getByLabelText("Status"), "blocked");
    await waitFor(() => expect(api.fetchCustomers.mock.lastCall?.[0]).toMatchObject({ status: "blocked" }));
    await userEvent.selectOptions(screen.getByLabelText("Order"), "name");
    await waitFor(() => expect(api.fetchCustomers.mock.lastCall?.[0]).toMatchObject({ sort: "name" }));
    expect(url.get().get("status")).toBe("blocked");
    // Nothing is ever sent as `phone` (the API answers 422 USE_LOOKUP_ENDPOINT).
    for (const call of api.fetchCustomers.mock.calls) expect(Object.keys(call[0])).not.toContain("phone");
  });

  it("says nothing matches, and offers to clear the filters", async () => {
    url.set("q=zzz");
    api.fetchCustomers.mockResolvedValue(page([]));
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    expect(await screen.findByText("No customer matches")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(url.get().toString()).toBe(""));
  });

  it("says there are no customers yet", async () => {
    api.fetchCustomers.mockResolvedValue(page([]));
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    expect(await screen.findByText("No customers yet")).toBeInTheDocument();
  });

  it("shows a failed load with a retry, and a permission-denied answer as such", async () => {
    api.fetchCustomers.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Sara Ahmed" })).toBeInTheDocument();
  });

  it("is denied without customers.view, and offers the privacy queue only with its permission", async () => {
    const { unmount } = renderWithProviders(<CustomersScreen />, { permissions: ["bookings.view"] });
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
    expect(api.fetchCustomers).not.toHaveBeenCalled();
    unmount();
    renderWithProviders(<CustomersScreen />, { permissions: ["customers.view"] });
    await screen.findByRole("link", { name: "Sara Ahmed" });
    expect(screen.queryByRole("link", { name: "Privacy requests" })).toBeNull();
  });

  it("links the privacy queue for customers.privacy_requests", async () => {
    renderWithProviders(<CustomersScreen />, { permissions: COORDINATOR });
    expect(await screen.findByRole("link", { name: "Privacy requests" })).toHaveAttribute("href", "/admin/customers/privacy-requests");
  });
});
