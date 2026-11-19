import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
import { waitlistEntry } from "@/test/workforceFixtures";
import type { WaitlistEntry, WaitlistPage } from "@/lib/admin/workforce/types";
import { renderWithProviders } from "@/test/render";
import { WaitlistScreen } from "./WaitlistScreen";

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
    usePathname: () => "/admin/waitlist",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchWaitlist: vi.fn(), notifyWaitlistEntry: vi.fn() };
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchWaitlist: (...a: unknown[]) => api.fetchWaitlist(...a),
  notifyWaitlistEntry: (...a: unknown[]) => api.notifyWaitlistEntry(...a),
}));
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => [
    { id: 3, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true },
    { id: 4, code: "DEMO_MR", name: { ar: "مردف", en: "Mirdif" }, is_active: true },
  ],
  fetchServiceOptions: async () => [],
  fetchSlotTemplateOptions: async () => [
    { id: 13, code: "MORNING", name: { ar: "الفترة الصباحية", en: "Morning" }, start_time: "10:00", end_time: "14:00", service_kind: "standard_visit", is_active: true },
  ],
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAFF = ["waitlist.manage", "schedule.view", "customers.view", "bookings.view"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });

const counts = { waiting: 2, notified: 1, converted: 1, expired: 1, cancelled: 1 };
const page = (data: WaitlistEntry[], over: Partial<WaitlistPage["meta"]> = {}): WaitlistPage => ({
  data,
  meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1, counts_by_status: counts, ...over },
});
const live = (over: Partial<WaitlistEntry> = {}) =>
  waitlistEntry({
    id: 42,
    status: "notified",
    position: null,
    offers_count: 1,
    offer: { state: "live", expires_at: "2026-10-23T12:35:00+00:00", offered_at: "2026-10-23T12:05:00+00:00", offered_by: { id: 7, name: "Huda" } },
    ...over,
  });
const open = (rows = [waitlistEntry()], permissions: readonly string[] = STAFF, locale: "en" | "ar" = "en") => {
  api.fetchWaitlist.mockResolvedValue(page(rows));
  return renderWithProviders(<WaitlistScreen />, { permissions, locale });
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  url.set("");
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
});
afterEach(() => vi.useRealTimers());

describe("A04 waitlist page (waitlist §7.1)", () => {
  it("lists each request: date and slot, zone, customer with a masked phone, service and team, the place in line, offers and when she joined", async () => {
    open();
    await screen.findByText("Maryam Saleh");
    expect(api.fetchWaitlist).toHaveBeenCalledWith({ dateFrom: undefined, dateTo: undefined, zoneId: undefined, slotTemplateId: undefined, status: ["open"], q: undefined, page: 1, perPage: 25 });
    const row = within(screen.getByRole("table", { name: "Waitlist requests" })).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Morning");
    expect(row).toHaveTextContent("10:00–14:00");
    expect(row).toHaveTextContent("Business Bay");
    expect(row).toHaveTextContent("Cleaning visit");
    expect(row).toHaveTextContent("2 cleaners");
    expect(row).toHaveTextContent("Waiting · #2");
    expect(row).toHaveTextContent("Slot now: limited, 2 left");
    expect(within(row).getByRole("link", { name: "Maryam Saleh" })).toHaveAttribute("href", "/admin/customers/01JA0000000000000000000001");
    expect(within(row).getByText("•••••••••4567")).toHaveAttribute("dir", "ltr");
  });

  it("says what each request is now from the API's status, offer and close reason", async () => {
    open([
      waitlistEntry({ id: 1 }),
      live({ id: 2 }),
      waitlistEntry({ id: 3, offers_count: 1, offer: { state: "lapsed", expires_at: null, offered_at: null, offered_by: null } }),
      waitlistEntry({ id: 4, status: "converted", position: null, closed_reason: "booked", booking: { id: 812, ulid: "01JB", reference: "TRB-AAAAAA" }, slot_now: null }),
      waitlistEntry({ id: 5, status: "expired", position: null, closed_reason: "cutoff", slot_now: null }),
      waitlistEntry({ id: 6, status: "expired", position: null, closed_reason: "offers_exhausted", slot_now: null }),
      waitlistEntry({ id: 7, status: "cancelled", position: null, closed_reason: "customer_left", slot_now: null }),
      waitlistEntry({ id: 8, status: "cancelled", position: null, closed_reason: "account_closed", slot_now: null }),
    ]);
    await screen.findAllByText("Maryam Saleh");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[1]).toHaveTextContent("Offer until 16:35");
    expect(rows[1]).toHaveTextContent(`Last by ${isolate("Huda")}`);
    expect(rows[2]).toHaveTextContent("Offer lapsed (1 sent)");
    expect(rows[2]).toHaveTextContent("Last automatic");
    expect(rows[3]).toHaveTextContent("Booked");
    expect(within(rows[3]).getByRole("link", { name: "TRB-AAAAAA" })).toHaveAttribute("href", "/admin/bookings/812");
    expect(rows[4]).toHaveTextContent("Expired: cut-off passed");
    expect(rows[5]).toHaveTextContent("Ended: offers used up");
    expect(rows[6]).toHaveTextContent("Left");
    expect(rows[7]).toHaveTextContent("Closed: account closed");
    // A closed request has nothing to offer.
    for (const closed of rows.slice(3)) expect(within(closed).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a deleted customer without a link, and only the phone when the name is withheld", async () => {
    open([waitlistEntry({ customer: { id: null, name: null, phone_masked: null, status: "deleted" } })]);
    expect(await screen.findByText("Deleted customer")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Deleted customer/ })).not.toBeInTheDocument();
  });

  it("shows the counts by status and filters by one when it is pressed", async () => {
    open();
    const user = userEvent.setup();
    await screen.findByText("Maryam Saleh");
    const chips = screen.getByRole("list", { name: "Requests by status" });
    expect(within(chips).getByRole("button", { name: /Waiting 2/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /Booked 1/ })).toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: /Booked 1/ }));
    await waitFor(() => expect(api.fetchWaitlist).toHaveBeenLastCalledWith(expect.objectContaining({ status: ["converted"] })));
    expect(within(chips).getByRole("button", { name: /Booked 1/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(chips).getByRole("button", { name: /Booked 1/ }));
    await waitFor(() => expect(api.fetchWaitlist).toHaveBeenLastCalledWith(expect.objectContaining({ status: ["open"] })));
  });

  it("asks for every status with All, and reads a link from the capacity view (date, zone, slot, open)", async () => {
    url.set("date_from=2026-10-26&date_to=2026-10-26&zone_id=3&slot_template_id=13&status=open");
    open();
    await screen.findByText("Maryam Saleh");
    expect(api.fetchWaitlist).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: "2026-10-26", dateTo: "2026-10-26", zoneId: 3, slotTemplateId: 13, status: ["open"] }));
    expect(screen.getByText("Showing the dates you chose.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "all");
    await waitFor(() => expect(api.fetchWaitlist).toHaveBeenLastCalledWith(expect.objectContaining({ status: ["waiting", "notified", "converted", "expired", "cancelled"] })));
  });

  it("says it shows today and the next 13 days until dates are chosen", async () => {
    open();
    expect(await screen.findByText("Showing today and the next 13 days. Choose dates to see others.")).toBeInTheDocument();
  });

  it("re-reads the list every minute as a background poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    open();
    await vi.waitFor(() => expect(screen.getByText("Maryam Saleh")).toBeInTheDocument());
    api.fetchWaitlist.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await vi.waitFor(() => expect(api.fetchWaitlist).toHaveBeenCalledTimes(1));
    expect(api.fetchWaitlist.mock.calls[0][1]).toEqual({ background: true });
  });
});

describe("the staff offer (Notify now and Notify again)", () => {
  it("tells the customer after a confirmation that names the push, SMS and in-app message and that nothing is held, with an Idempotency-Key and no force", async () => {
    api.notifyWaitlistEntry.mockResolvedValue(live({ id: 41 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notify now: Maryam Saleh" }));
    const dialog = screen.getByRole("alertdialog", { name: /Tell .*Maryam Saleh.* that a place is free\?/ });
    expect(dialog).toHaveTextContent("a push, an SMS and an in-app message");
    expect(dialog).toHaveTextContent("Nothing is held: the place goes to whoever completes payment first.");
    expect(api.notifyWaitlistEntry).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Notify now" }));
    await waitFor(() => expect(api.notifyWaitlistEntry).toHaveBeenCalledTimes(1));
    expect(api.notifyWaitlistEntry.mock.calls[0][0]).toBe(41);
    expect(api.notifyWaitlistEntry.mock.calls[0][1]).toMatch(UUID);
    expect(api.notifyWaitlistEntry.mock.calls[0][2]).toBe(false);
    expect(await screen.findByText(/was notified\./)).toBeInTheDocument();
    // The row is read again.
    await waitFor(() => expect(api.fetchWaitlist.mock.calls.length).toBeGreaterThan(1));
  });

  it("offers Notify again over a live offer, says so, and sends force only after that confirmation (P5-L32)", async () => {
    api.notifyWaitlistEntry.mockResolvedValue(live());
    open([live()]);
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: /^Notify now/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Notify again: Maryam Saleh" }));
    const dialog = screen.getByRole("alertdialog", { name: /Notify .*Maryam Saleh.* again\?/ });
    expect(dialog).toHaveTextContent("already has a live offer");
    expect(dialog).toHaveTextContent("The current offer runs until 16:35.");
    expect(api.notifyWaitlistEntry).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Notify again" }));
    await waitFor(() => expect(api.notifyWaitlistEntry).toHaveBeenCalledTimes(1));
    expect(api.notifyWaitlistEntry.mock.calls[0][0]).toBe(42);
    expect(api.notifyWaitlistEntry.mock.calls[0][2]).toBe(true);
  });

  it("disables the button with the API's reason, for each reason, and opens nothing", async () => {
    const reasons = {
      closed: "The request is closed.",
      slot_closed: "The slot can no longer be booked.",
      customer_inactive: "The customer's account is not active.",
      address_unavailable: "The customer's address cannot be served.",
      slot_full: "The slot has no place free right now.",
      offer_limit: "The request has had the most offers allowed.",
    } as const;
    open(Object.entries(reasons).map(([reason], i) => waitlistEntry({ id: i + 1, actions: { notify: false, notify_blocked_reason: reason as keyof typeof reasons } })));
    await screen.findAllByText("Maryam Saleh");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    Object.values(reasons).forEach((text, i) => {
      const button = within(rows[i]).getByRole("button", { name: /Notify now/ });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(text);
      expect(rows[i]).toHaveTextContent(text);
    });
  });

  it.each([
    ["OFFER_LIVE", 409, { expires_at: "2026-10-23T12:35:00+00:00" }, "A place was just offered and the offer runs until 16:35. Use “Notify again” only if you mean to send another."],
    ["WAITLIST_SLOT_UNAVAILABLE", 409, { status: "full", remaining_workers: 1 }, "The slot has no place free for this team (1 cleaner is free now), so no place can be offered."],
    ["WAITLIST_SLOT_UNAVAILABLE", 409, { status: "closed" }, "the booking cut-off has passed, the slot is closed"],
    ["OFFER_LIMIT_REACHED", 409, { max: 20 }, "has had the most offers allowed (20)"],
    ["CUSTOMER_NOT_ACTIVE", 409, { status: "blocked" }, "The customer's account is not active, so no place can be offered."],
    ["ADDRESS_UNAVAILABLE", 409, {}, "The customer's address cannot be served any more"],
    ["INVALID_STATE", 409, { status: "converted" }, "This request is booked, so no place can be offered."],
    ["WAITLIST_NOTICE_DISABLED", 409, {}, "switched off in the notification templates"],
    ["WAITLIST_BUSY", 409, {}, "The slot is being updated by another action."],
  ])("shows %s in words, re-reads the page, and then only closes", async (code, status, details, text) => {
    api.notifyWaitlistEntry.mockRejectedValue(apiError(status, code, details));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notify now: Maryam Saleh" }));
    const dialog = screen.getByRole("alertdialog");
    const before = api.fetchWaitlist.mock.calls.length;
    await user.click(within(dialog).getByRole("button", { name: "Notify now" }));
    expect(await within(dialog).findByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    await waitFor(() => expect(api.fetchWaitlist.mock.calls.length).toBeGreaterThan(before));
    // The same offer would be refused again: the button now closes the dialog.
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.notifyWaitlistEntry).toHaveBeenCalledTimes(1);
  });

  it("says how many seconds to wait on a 429 and sends the repeat with the same key", async () => {
    api.notifyWaitlistEntry.mockRejectedValueOnce(apiError(429, "RATE_LIMITED", { retry_after_seconds: 30 })).mockResolvedValueOnce(live({ id: 41 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Notify now: Maryam Saleh" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Notify now" }));
    expect(await within(dialog).findByText(/30/)).toBeInTheDocument();
    // A 429 is not a refusal of this offer: the dialog stays open for the repeat, with the same key.
    await user.click(within(dialog).getByRole("button", { name: "Notify now" }));
    await waitFor(() => expect(api.notifyWaitlistEntry).toHaveBeenCalledTimes(2));
    expect(api.notifyWaitlistEntry.mock.calls[1][1]).toBe(api.notifyWaitlistEntry.mock.calls[0][1]);
  });
});

describe("states", () => {
  it("needs waitlist.manage", () => {
    renderWithProviders(<WaitlistScreen />, { permissions: ["schedule.view"] });
    expect(api.fetchWaitlist).not.toHaveBeenCalled();
  });

  it("has an empty state, a filtered empty state and an error state with a retry", async () => {
    api.fetchWaitlist.mockResolvedValueOnce(page([], { counts_by_status: { waiting: 0, notified: 0, converted: 0, expired: 0, cancelled: 0 } }));
    const { unmount } = renderWithProviders(<WaitlistScreen />, { permissions: STAFF });
    expect(await screen.findByText("No one is waiting for these dates")).toBeInTheDocument();
    unmount();
    url.set("zone_id=4");
    api.fetchWaitlist.mockResolvedValueOnce(page([]));
    const filtered = renderWithProviders(<WaitlistScreen />, { permissions: STAFF });
    expect(await screen.findByText("No request matches these filters.")).toBeInTheDocument();
    filtered.unmount();
    url.set("");
    api.fetchWaitlist.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(page([waitlistEntry()]));
    renderWithProviders(<WaitlistScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("Maryam Saleh")).toBeInTheDocument();
  });

  it("is written in Arabic: the offer time, the place in line and the dialog", async () => {
    api.notifyWaitlistEntry.mockResolvedValue(live());
    open([waitlistEntry(), live({ id: 42 })], STAFF, "ar");
    const user = userEvent.setup();
    await screen.findAllByText("Maryam Saleh");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("قائمة الانتظار");
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("في الانتظار · رقم 2");
    expect(rows[2]).toHaveTextContent("العرض حتى 16:35");
    await user.click(screen.getByRole("button", { name: /إشعار الآن/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("لا شيء محجوز");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
