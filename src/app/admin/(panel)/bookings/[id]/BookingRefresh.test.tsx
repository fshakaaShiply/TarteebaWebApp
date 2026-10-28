import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { VisitCandidates } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingDetailScreen } from "./BookingDetailScreen";

const api = { fetchBooking: vi.fn(), confirmBooking: vi.fn(), fetchVisitCandidates: vi.fn(), fetchRefundsByPhone: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  confirmBooking: (...a: unknown[]) => api.confirmBooking(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  fetchRefundsByPhone: (...a: unknown[]) => api.fetchRefundsByPhone(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const COORDINATOR = ["bookings.view", "bookings.confirm", "bookings.reject", "assignments.manage", "schedule.view"];

/** Another coordinator named both cleaners from the A04 board. */
const TEAM = [
  { worker_id: 1, display_name: "Maria S.", role: "cleaner", assigned_at: "2026-10-23T15:59:00Z" },
  { worker_id: 4, display_name: "Nirmala P.", role: "cleaner", assigned_at: "2026-10-23T15:59:00Z" },
];
const assignedElsewhere = () => {
  const visit = bookingDetail().visits[0];
  return bookingDetail({ version: 4, visits: [{ ...visit, status: "worker_assigned", status_label: { ar: "تم التعيين", en: "Worker assigned" }, assignments: TEAM }] });
};
const candidatesOfTeam = (): VisitCandidates => {
  const base = visitCandidates(0);
  return {
    ...base,
    visit: {
      ...base.visit,
      version: 2,
      status: "worker_assigned",
      status_label: { ar: "تم التعيين", en: "Worker assigned" },
      assigned_count: 2,
      missing: 0,
      workers: TEAM.map((a) => ({ id: a.worker_id, display_name: a.display_name, full_name: { ar: a.display_name, en: a.display_name }, assigned_at: a.assigned_at })),
    },
  };
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const cleaners = () => screen.getByRole("heading", { level: 2, name: "Cleaners" }).closest("section")!;

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
};
const seconds = (n: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(n * 1000);
  });

/** A03 booking page: the timed refresh (background polls, spec §13.2). */
describe("A03 booking page refresh", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchBooking.mockResolvedValue(bookingDetail());
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  it("re-reads the booking every 30 seconds as a background poll; opening the page and Refresh are ordinary loads", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    expect(await screen.findByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(api.fetchBooking.mock.calls).toEqual([[4]]);

    // Another coordinator confirmed it meanwhile: the poll shows it without a click.
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured", version: 4 }));
    await seconds(30);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument());
    expect(api.fetchBooking.mock.calls).toEqual([[4], [4, { background: true }]]);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(3));
    expect(api.fetchBooking).toHaveBeenLastCalledWith(4);
  });

  it("a poll never changes an open dialog's snapshot: it still sends the version it opened with", async () => {
    api.confirmBooking.mockRejectedValue(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: {} }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm TRB-R4RYSD?" });

    api.fetchBooking.mockResolvedValue(bookingDetail({ version: 4 }));
    await seconds(30);
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText("This booking changed")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog", { name: "Confirm TRB-R4RYSD?" })).toBe(dialog);

    await user.click(within(dialog).getByRole("button", { name: "Confirm and take payment" }));
    await waitFor(() => expect(api.confirmBooking).toHaveBeenCalledTimes(1));
    expect(api.confirmBooking.mock.calls[0].slice(0, 2)).toEqual([4, 3]);
  });

  it("pauses while the tab is hidden", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    await screen.findByRole("button", { name: "Confirm" });
    setVisibility("hidden");
    await seconds(5 * 60);
    expect(api.fetchBooking).toHaveBeenCalledTimes(1);

    // Shown again: the focus refetch (an ordinary load), then background polls.
    setVisibility("visible");
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(2));
    expect(api.fetchBooking).toHaveBeenLastCalledWith(4);
    await seconds(30);
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(3));
    expect(api.fetchBooking).toHaveBeenLastCalledWith(4, { background: true });
  });

  it("a failed poll keeps the booking on screen", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    await screen.findByRole("button", { name: "Confirm" });
    api.fetchBooking.mockRejectedValue(new AdminApiError(0, { code: "NETWORK_ERROR", message: "", details: {} }));
    await seconds(30);
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { level: 1, name: /TRB-R4RYSD/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("a poll that brings a team named elsewhere shows it in the cleaners card and re-reads the candidates as a background poll", async () => {
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(2));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    expect(await screen.findByRole("heading", { name: "Suggested cleaners" })).toBeInTheDocument();
    expect(within(cleaners()).getByText("0 of 2 assigned")).toBeInTheDocument();
    expect(api.fetchVisitCandidates.mock.calls).toEqual([[4, { background: false }]]);

    // The candidates answer late: meanwhile the card already follows the booking, without the stale picker.
    const late = deferred<VisitCandidates>();
    api.fetchVisitCandidates.mockReturnValue(late.promise);
    api.fetchBooking.mockResolvedValue(assignedElsewhere());
    await seconds(30);
    await waitFor(() => expect(within(cleaners()).getByText("2 of 2 assigned")).toBeInTheDocument());
    expect(within(cleaners()).queryByText("No cleaner is assigned yet.")).not.toBeInTheDocument();
    expect(within(cleaners()).queryByRole("heading", { name: "Suggested cleaners" })).not.toBeInTheDocument();
    expect(within(cleaners()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(cleaners()).getByText("Nirmala P.")).toBeInTheDocument();
    expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(2);
    expect(api.fetchVisitCandidates).toHaveBeenLastCalledWith(4, { background: true });

    await act(async () => late.resolve(candidatesOfTeam()));
    expect(within(cleaners()).getByText("2 of 2 assigned")).toBeInTheDocument();
    expect(within(cleaners()).getByRole("button", { name: "Remove Maria S. from the visit" })).toBeInTheDocument();
    // An unchanged poll reads nothing more.
    await seconds(30);
    await waitFor(() => expect(api.fetchBooking).toHaveBeenCalledTimes(3));
    expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(2);
  });

  it("Refresh re-reads the candidates too, as an ordinary load", async () => {
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: COORDINATOR });
    await screen.findByRole("heading", { name: "Suggested cleaners" });
    expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(1);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(2));
    expect(api.fetchVisitCandidates).toHaveBeenLastCalledWith(4, { background: false });
  });

  it("reads a poll's change turns on are background polls too, until the user acts", async () => {
    // A manual booking held for its payment link: no candidates and no refunds to read yet.
    const held = bookingDetail({ status: "held", status_label: { ar: "محجوز", en: "Held" }, payment_status: "pending", hold_expires_at: "2026-10-23T16:30:00+00:00" });
    api.fetchBooking.mockResolvedValue(held);
    api.fetchRefundsByPhone.mockResolvedValue([]);
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: [...COORDINATOR, "payments.view"] });
    await screen.findByRole("heading", { level: 1, name: /TRB-R4RYSD/ });
    expect(api.fetchVisitCandidates).not.toHaveBeenCalled();
    expect(api.fetchRefundsByPhone).not.toHaveBeenCalled();

    // Nobody at the screen: the customer pays, the poll brings the request waiting for confirmation.
    const paid = bookingDetail({ version: 4, payment_status: "captured", payment: { ...held.payment!, status: "captured", captured_fils: 24000 } });
    api.fetchBooking.mockResolvedValue(paid);
    await seconds(30);
    await waitFor(() => expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(1));
    expect(api.fetchVisitCandidates).toHaveBeenLastCalledWith(4, { background: true });
    await waitFor(() => expect(api.fetchRefundsByPhone).toHaveBeenCalledTimes(1));
    expect(api.fetchRefundsByPhone).toHaveBeenLastCalledWith("+971500000001", { background: true });

    // Back at the screen: the next reads count as activity again.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.fetchVisitCandidates).toHaveBeenCalledTimes(2));
    expect(api.fetchVisitCandidates).toHaveBeenLastCalledWith(4, { background: false });
  });

  it("does not poll a page whose id is not a booking id", async () => {
    renderWithProviders(<BookingDetailScreen id="abc" />, { permissions: COORDINATOR });
    await seconds(60);
    expect(api.fetchBooking).not.toHaveBeenCalled();
  });
});
