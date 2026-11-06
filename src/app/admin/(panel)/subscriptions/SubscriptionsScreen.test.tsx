import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import type { Worker } from "@/lib/admin/types";
import { zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { subscriptionPage, subscriptionRow } from "@/test/subscriptionFixtures";
import { SubscriptionsScreen } from "./SubscriptionsScreen";

// The page URL: useSearchParams follows history.replaceState like Next's own integration does.
const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next.split("?")[1] ?? "");
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
    usePathname: () => "/admin/subscriptions",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchSubscriptions: vi.fn(), fetchAllWorkers: vi.fn() };
vi.mock("@/lib/admin/subscriptions/endpoints", () => ({
  fetchSubscriptions: (...a: unknown[]) => api.fetchSubscriptions(...a),
}));
vi.mock("@/lib/admin/endpoints", () => ({
  fetchAllWorkers: (...a: unknown[]) => api.fetchAllWorkers(...a),
  fetchZoneOptions: async () => zoneOptions,
}));

const worker = (id: number, name: string) => ({ id, display_name: name, employment_status: "active" }) as Worker;
const READ = ["subscriptions.view", "bookings.view"];

describe("A08 subscriptions list", () => {
  let replaceState: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    api.fetchSubscriptions.mockReset();
    api.fetchSubscriptions.mockResolvedValue(subscriptionPage([subscriptionRow()], { active: 4, pending_confirmation: 2, paused: 1 }));
    api.fetchAllWorkers.mockReset();
    api.fetchAllWorkers.mockResolvedValue([worker(14, "Maria S."), worker(15, "Rosa")]);
    replaceState = vi.spyOn(window.history, "replaceState").mockImplementation((_data, _unused, next) => url.set(String(next)));
  });
  afterEach(() => {
    replaceState.mockRestore();
    url.set("/admin/subscriptions");
  });

  it("lists subscriptions with the status and payment chips and a link to the detail", async () => {
    api.fetchSubscriptions.mockResolvedValue(
      subscriptionPage([
        subscriptionRow(),
        subscriptionRow({ id: 32, reference: "TRS-PAUSE1", status: "paused", status_label: { ar: "مجمّد", en: "Frozen" }, paused_to: "2026-11-02", payment_health: "paid" }),
        subscriptionRow({ id: 33, reference: "TRS-FAIL01", status: "renewal_failed", status_label: { ar: "فشل التجديد", en: "Renewal failed" }, payment_health: "renewal_failed", renewal_attempts: 2 }),
        subscriptionRow({
          id: 34,
          reference: "TRS-PEND01",
          status: "pending_confirmation",
          status_label: { ar: "بانتظار التأكيد", en: "Pending confirmation" },
          payment_health: "verifying",
          next_renewal_at: null,
          confirmation_deadline_at: "2099-10-23T08:00:00+00:00",
        }),
      ]),
    );
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    const active = (await screen.findByRole("link", { name: "TRS-7K2M9Q" })).closest("tr") as HTMLElement;
    expect(within(active).getByText("Active")).toBeInTheDocument();
    expect(within(active).getByText("Paid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");

    const frozen = screen.getByRole("link", { name: "TRS-PAUSE1" }).closest("tr") as HTMLElement;
    expect(within(frozen).getByText(/Frozen until/)).toBeInTheDocument();
    const failed = screen.getByRole("link", { name: "TRS-FAIL01" }).closest("tr") as HTMLElement;
    expect(within(failed).getByText("Renewal failed")).toBeInTheDocument();
    expect(within(failed).getByText("Payment failed")).toBeInTheDocument();
    expect(within(failed).getByText("Renewal attempts: 2")).toBeInTheDocument();
    const pending = screen.getByRole("link", { name: "TRS-PEND01" }).closest("tr") as HTMLElement;
    expect(within(pending).getByText("Pending confirmation")).toBeInTheDocument();
    expect(within(pending).getByText("Payment being checked")).toBeInTheDocument();
  });

  it("sets the workers' names as their own bidi runs, so a Latin name keeps its period in Arabic", async () => {
    api.fetchSubscriptions.mockResolvedValue(subscriptionPage([subscriptionRow({ backup_worker: { id: 15, name: "Siti R." } })]));
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ, locale: "ar" });
    const row = (await screen.findByRole("link", { name: "TRS-7K2M9Q" })).closest("tr") as HTMLElement;
    expect(row.querySelector("bdi:not([dir])")).toHaveTextContent("Maria S.");
    expect(within(row).getByText("البديلة: \u2068Siti R.\u2069")).toBeInTheDocument();
  });

  it("shows the renewal and first-visit dates as Dubai dates, not the UTC instant's date", async () => {
    // renewal_time 02:00 on 29 Nov (Dubai) is 22:00 UTC on 28 Nov; the first visit at 01:00 on 1 Nov is 21:00 UTC on 31 Oct.
    api.fetchSubscriptions.mockResolvedValue(
      subscriptionPage([
        subscriptionRow({ next_renewal_at: "2026-11-28T22:00:00+00:00" }),
        subscriptionRow({
          id: 34,
          reference: "TRS-PEND01",
          status: "pending_confirmation",
          next_renewal_at: null,
          first_visit_at: "2026-10-31T21:00:00+00:00",
          confirmation_deadline_at: "2099-10-23T08:00:00+00:00",
        }),
      ]),
    );
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    const row = (await screen.findByRole("link", { name: "TRS-7K2M9Q" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Sun, 29 Nov 2026")).toBeInTheDocument();
    expect(within(row).queryByText("Sat, 28 Nov 2026")).not.toBeInTheDocument();
    const pending = screen.getByRole("link", { name: "TRS-PEND01" }).closest("tr") as HTMLElement;
    expect(within(pending).getByText("First visit Sun, 1 Nov 2026")).toBeInTheDocument();
  });

  it("marks conflicts and a cancellation review on the row", async () => {
    api.fetchSubscriptions.mockResolvedValue(subscriptionPage([subscriptionRow({ conflicts_count: 2, cancel_review_requested_at: "2026-10-23T10:00:00+00:00" })]));
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    const row = (await screen.findByRole("link", { name: "TRS-7K2M9Q" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Conflicts: 2")).toBeInTheDocument();
    expect(within(row).getByText("Cancellation review")).toBeInTheDocument();
  });

  it("opens filtered from the overview's links and sends the API's own filter names", async () => {
    url.set("/admin/subscriptions?status=pending_confirmation&cancel_review=1&zone_id=2");
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    await screen.findByRole("link", { name: "TRS-7K2M9Q" });
    expect(api.fetchSubscriptions).toHaveBeenLastCalledWith(expect.objectContaining({ status: ["pending_confirmation"], cancelReview: true, zoneId: 2, page: 1 }));
    expect(screen.getByRole("checkbox", { name: "Cancellation review" })).toBeChecked();
    expect(screen.getByRole("button", { name: /Pending confirmation/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps filters in the URL: a type, payment, the conflicts box and a status chip", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    await screen.findByRole("link", { name: "TRS-7K2M9Q" });
    await user.selectOptions(screen.getByLabelText("Type"), "live_out");
    await user.selectOptions(screen.getByLabelText("Payment"), "renewal_failed");
    await user.click(screen.getByRole("checkbox", { name: "With conflicts" }));
    await user.click(screen.getByRole("button", { name: /Frozen/ }));
    await waitFor(() => expect(url.get().toString()).toContain("status=paused"));
    expect(Object.fromEntries(url.get())).toMatchObject({ type: "live_out", payment_health: "renewal_failed", conflicts: "1", status: "paused" });
    await waitFor(() =>
      expect(api.fetchSubscriptions).toHaveBeenLastCalledWith(expect.objectContaining({ type: "live_out", paymentHealth: "renewal_failed", conflicts: true, status: ["paused"] })),
    );
  });

  it("filters by worker for users who can read workers, and hides the filter otherwise", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<SubscriptionsScreen />, { permissions: [...READ, "workers.view"] });
    await screen.findByRole("link", { name: "TRS-7K2M9Q" });
    // An <option> holds text only: each name is its own bidi run, so "Maria S." never shows as ".Maria S" in Arabic.
    const filter = await screen.findByLabelText("Worker");
    await waitFor(() => expect(within(filter).getByRole("option", { name: isolate("Maria S.") })).toHaveValue("14"));
    await user.selectOptions(filter, "15");
    await waitFor(() => expect(api.fetchSubscriptions).toHaveBeenLastCalledWith(expect.objectContaining({ workerId: 15 })));
    unmount();
    url.set("/admin/subscriptions");
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    await screen.findByRole("link", { name: "TRS-7K2M9Q" });
    expect(screen.queryByLabelText("Worker")).not.toBeInTheDocument();
  });

  it("says nothing is found, with filters set, and offers to clear them", async () => {
    url.set("/admin/subscriptions?conflicts=1");
    api.fetchSubscriptions.mockResolvedValue(subscriptionPage([]));
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    expect(await screen.findByText("No subscription matches these filters")).toBeInTheDocument();
  });

  it("shows an error with retry and the permission-denied state", async () => {
    const user = userEvent.setup();
    api.fetchSubscriptions.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ });
    const retry = await screen.findByRole("button", { name: "Try again" });
    await user.click(retry);
    expect(await screen.findByRole("link", { name: "TRS-7K2M9Q" })).toBeInTheDocument();
  });

  it("is closed to staff without a subscription permission", async () => {
    renderWithProviders(<SubscriptionsScreen />, { permissions: ["bookings.view"] });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchSubscriptions).not.toHaveBeenCalled();
  });

  it("reads Arabic", async () => {
    renderWithProviders(<SubscriptionsScreen />, { permissions: READ, locale: "ar" });
    expect(await screen.findByRole("heading", { name: "الاشتراكات" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "TRS-7K2M9Q" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "الدفع" })).toBeInTheDocument();
  });
});
