import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAlert } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { AlertsBell } from "./AlertsBell";

const api = { fetchAlerts: vi.fn(), markAlertRead: vi.fn(), markAllAlertsRead: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchAlerts: (...a: unknown[]) => api.fetchAlerts(...a),
  markAlertRead: (...a: unknown[]) => api.markAlertRead(...a),
  markAllAlertsRead: (...a: unknown[]) => api.markAllAlertsRead(...a),
}));

const alert = (id: string, over: Partial<AdminAlert> = {}): AdminAlert => ({
  id,
  event: "booking.requested",
  priority: "normal",
  urgent: false,
  title: `New request TRB-${id}`,
  body: "Cleaning visit on Monday",
  link: "/admin/bookings/12",
  entity: { type: "booking", id: 12, reference: `TRB-${id}` },
  read: false,
  read_at: null,
  created_at: "2026-10-23T10:00:00Z",
  ...over,
});

/** The bell's own live region (the toasts have another one). */
const announcer = () => within(screen.getByRole("button", { name: /^Alerts/ }).parentElement!).getByRole("status");

describe("alerts bell (D-11: polled every 20 s)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.values(api).forEach((fn) => fn.mockReset());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the newest page, then asks only for what is new since the last answer", async () => {
    api.fetchAlerts
      .mockResolvedValueOnce({
        data: [alert("AAAAA1")],
        meta: { unread_count: 1, server_time: "2026-10-23T10:00:05Z", poll_seconds: 20, current_page: 1, per_page: 20, total: 1, last_page: 1 },
      })
      .mockResolvedValueOnce({
        data: [alert("AAAAA2", { urgent: true, title: "Visit missed TRB-AAAAA2", created_at: "2026-10-23T10:00:15Z" })],
        meta: { unread_count: 2, server_time: "2026-10-23T10:00:25Z", poll_seconds: 20 },
      })
      .mockResolvedValue({ data: [], meta: { unread_count: 2, server_time: "2026-10-23T10:00:45Z", poll_seconds: 20 } });

    renderWithProviders(<AlertsBell />, { permissions: [] });
    expect(await screen.findByRole("button", { name: "Alerts, 1 unread" })).toBeInTheDocument();
    expect(api.fetchAlerts).toHaveBeenNthCalledWith(1, { perPage: 20 });
    // The first load is not announced, only what later polls bring.
    expect(announcer()).toHaveTextContent("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(api.fetchAlerts).toHaveBeenNthCalledWith(2, { since: "2026-10-23T10:00:05Z" }));
    expect(await screen.findByRole("button", { name: "Alerts, 2 unread" })).toBeInTheDocument();
    // Screen readers hear the arrival (the badge is aria-hidden and a changed button name is not read out).
    expect(announcer()).toHaveTextContent("1 new urgent alert");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(api.fetchAlerts).toHaveBeenNthCalledWith(3, { since: "2026-10-23T10:00:25Z" }));
    // A poll with nothing new clears the region (nothing is repeated).
    await waitFor(() => expect(announcer()).toHaveTextContent(""));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Alerts, 2 unread" }));
    const panel = screen.getByRole("dialog", { name: "Alerts" });
    const items = within(panel).getAllByRole("listitem");
    // Newest first; the urgent one is marked.
    expect(items[0]).toHaveTextContent("Visit missed TRB-AAAAA2");
    expect(within(items[0]).getByText("Urgent")).toBeInTheDocument();
    expect(within(items[1]).getByRole("link", { name: "New request TRB-AAAAA1" })).toHaveAttribute("href", "/admin/bookings/12");
  });

  it("marks one alert read, then all", async () => {
    api.fetchAlerts.mockResolvedValue({
      data: [alert("BBBBB1"), alert("BBBBB2", { created_at: "2026-10-23T09:00:00Z" })],
      meta: { unread_count: 2, server_time: "2026-10-23T10:00:05Z", poll_seconds: 20 },
    });
    api.markAlertRead.mockImplementation(async (id: string) => ({ alert: alert(id, { read: true, read_at: "2026-10-23T10:01:00Z" }), unreadCount: 1 }));
    api.markAllAlertsRead.mockResolvedValue({ updated: 1, unreadCount: 0 });

    renderWithProviders(<AlertsBell />, { permissions: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Alerts, 2 unread" }));
    await user.click(screen.getByRole("button", { name: "Mark read: New request TRB-BBBBB1" }));

    expect(api.markAlertRead).toHaveBeenCalledWith("BBBBB1");
    expect(await screen.findByRole("button", { name: "Alerts, 1 unread" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark read: New request TRB-BBBBB1" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(api.markAllAlertsRead).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Alerts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark read/ })).not.toBeInTheDocument();
  });

  it("closes with Escape and gives focus back to the bell", async () => {
    api.fetchAlerts.mockResolvedValue({ data: [], meta: { unread_count: 0, server_time: "2026-10-23T10:00:05Z", poll_seconds: 20 } });
    renderWithProviders(<AlertsBell />, { permissions: [] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bell = await screen.findByRole("button", { name: "Alerts" });
    await user.click(bell);
    expect(await screen.findByText("No alerts yet.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Alerts" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });
});
