import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { DashboardAlerts } from "@/lib/admin/types";
import { bookingRow, dashboardSummary, serviceOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { OverviewScreen } from "./OverviewScreen";

const api = { fetchDashboardSummary: vi.fn(), fetchDashboardAlerts: vi.fn(), fetchBookings: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchDashboardSummary: (...a: unknown[]) => api.fetchDashboardSummary(...a),
  fetchDashboardAlerts: (...a: unknown[]) => api.fetchDashboardAlerts(...a),
  fetchBookings: (...a: unknown[]) => api.fetchBookings(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const alerts: DashboardAlerts = {
  data: [
    {
      type: "sla_due",
      severity: "urgent",
      at: "2026-10-23T08:00:00+00:00",
      title: { ar: "تأكيد مستحق", en: "Confirmation due" },
      message: { ar: "…", en: "The confirmation deadline of request TRB-R4RYSD passed at 12:00." },
      entity: { type: "booking", id: 4, reference: "TRB-R4RYSD" },
      link: { list: "booking", path: "/api/v1/admin/bookings/4", params: {} },
      details: {},
    },
    {
      type: "payment_failed",
      severity: "warning",
      at: "2026-10-23T09:00:00+00:00",
      title: { ar: "فشل الدفع", en: "Payment failed" },
      message: { ar: "…", en: "A payment failed." },
      entity: { type: "payment", id: 9 },
      link: { list: "payment", path: "/api/v1/admin/payments/9", params: {} },
      details: {},
    },
  ],
  meta: { generated_at: "", date: "2026-10-23", timezone: "Asia/Dubai", zone: null, types: [], counts: {}, total: 2, urgent: 1, limit_per_type: 50 },
};

const consoleError = vi.spyOn(console, "error");

describe("A02 daily operations overview", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchDashboardSummary.mockResolvedValue(dashboardSummary());
    api.fetchDashboardAlerts.mockResolvedValue(alerts);
    api.fetchBookings.mockResolvedValue({ data: [bookingRow()], meta: { current_page: 1, per_page: 5, total: 1, last_page: 1 } });
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("shows exactly four KPI cards, each opening its filtered list", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view", "bookings.create_manual"] });

    const today = await screen.findByRole("link", { name: /Today's bookings/ });
    expect(today).toHaveAttribute("href", "/admin/bookings?from=2026-10-23&to=2026-10-23");
    expect(today).toHaveTextContent("18");
    expect(today).toHaveTextContent("Morning 10 · Evening 8");
    expect(today).toHaveTextContent("26 cleaners booked");

    const pending = screen.getByRole("link", { name: /^Pending confirmation\s*6/ });
    expect(pending).toHaveAttribute("href", "/admin/bookings?status=pending_confirmation");
    expect(pending).toHaveTextContent("Next deadline in 35 minutes");
    expect(pending).toHaveTextContent("Oldest waiting for 2 hours 10 minutes");
    expect(pending).toHaveTextContent("1 request past the deadline");

    // All zones, today: the API names the A04 board (a later phase), so the card narrows this page's alerts list to
    // the same visits instead of opening one zone's capacity view.
    expect(screen.queryByRole("link", { name: /Uncovered visits/ })).not.toBeInTheDocument();
    const uncovered = screen.getByRole("button", { name: /Uncovered visits/ });
    expect(uncovered).toHaveTextContent("3 cleaners still to assign");
    expect(uncovered).toHaveTextContent("Show them in the alerts list");

    // On-time counts arrived visits, which only the A04 board lists: plain figures, not the day's full bookings list.
    expect(screen.queryByRole("link", { name: /On-time arrival/ })).not.toBeInTheDocument();
    const onTime = screen.getByText("On-time arrival").parentElement!;
    expect(onTime).toHaveTextContent("92%");
    expect(onTime).toHaveTextContent("11 of 12 on time · 1 late");

    expect(today.parentElement?.children).toHaveLength(4);
    expect(api.fetchDashboardSummary).toHaveBeenCalledWith({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), zoneId: null });
    expect(screen.getByRole("link", { name: "Manual booking" })).toHaveAttribute("href", "/admin/bookings/new");
  });

  it("uncovered visits across all zones: the card narrows the alerts to today's uncovered visits of every zone", async () => {
    api.fetchDashboardAlerts.mockResolvedValue({
      ...alerts,
      data: [
        ...alerts.data,
        {
          type: "visit_uncovered",
          severity: "urgent",
          at: "2026-10-23T06:00:00+00:00",
          title: { ar: "…", en: "Visit without its team" },
          message: { ar: "…", en: "TRB-UNCOV1 at 10:00 still needs 2 cleaners." },
          entity: { type: "visit", id: 31, booking_id: 12, reference: "TRB-UNCOV1" },
          link: { list: "booking", path: "/api/v1/admin/bookings/12", params: {} },
          details: { zone_id: 2 },
        },
      ],
      meta: { ...alerts.meta, counts: { visit_uncovered: 1, sla_due: 1, payment_failed: 1 }, total: 3, urgent: 2 },
    } satisfies DashboardAlerts);
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Uncovered visits/ }));

    const title = await screen.findByText("Uncovered visits today, all zones");
    await waitFor(() => expect(title).toHaveFocus());
    const card = title.closest("section")!;
    expect(within(card).getByRole("link", { name: "Open: Visit without its team" })).toHaveAttribute("href", "/admin/bookings/12");
    expect(within(card).queryByText("Confirmation due")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Show all alerts" }));
    expect(within(card).getByText("Confirmation due")).toBeInTheDocument();
  });

  it("uncovered visits on another day without a zone: no list covers them, so the card asks for a zone", async () => {
    api.fetchDashboardSummary.mockResolvedValue({ ...dashboardSummary(), is_today: false });
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    expect(await screen.findByText("Choose a zone in the top bar to open its list")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Uncovered visits/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uncovered visits/ })).not.toBeInTheDocument();
  });

  it("uncovered visits in one zone open that zone's capacity view, whose list is exactly the card's visits", async () => {
    const summary = dashboardSummary({
      uncovered_visits: {
        label: { ar: "زيارات غير مغطاة", en: "Uncovered visits" },
        value: 1,
        missing_workers: 2,
        link: { list: "capacity", path: "/api/v1/admin/capacity", params: { date: "2026-10-23", zone_id: 1 } },
      },
    });
    api.fetchDashboardSummary.mockResolvedValue({ ...summary, zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay & Downtown" } } });
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    expect(await screen.findByRole("link", { name: /Uncovered visits/ })).toHaveAttribute("href", "/admin/capacity?date=2026-10-23&zone_id=1");
  });

  describe("timed refresh", () => {
    const query = { date: "2026-10-23", zoneId: null };
    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    };
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      Reflect.deleteProperty(document, "visibilityState");
      vi.useRealTimers();
    });
    const minutes = (n: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(n * 60_000);
      });

    it("re-reads the summary and the alerts every minute as background polls; opening the page and Refresh are ordinary loads", async () => {
      renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
      expect(await screen.findByRole("link", { name: /Today's bookings/ })).toHaveTextContent("18");
      // Opening the page counts as activity: no background flag.
      expect(api.fetchDashboardSummary.mock.calls).toEqual([[query]]);
      expect(api.fetchDashboardAlerts.mock.calls).toEqual([[{ zoneId: null }]]);
      await waitFor(() => expect(api.fetchBookings).toHaveBeenCalled());
      const listLoads = api.fetchBookings.mock.calls.length;

      api.fetchDashboardSummary.mockResolvedValue(dashboardSummary({ todays_bookings: { ...dashboardSummary().cards.todays_bookings, value: 19 } }));
      await minutes(1);
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(2));
      expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith(query, { background: true });
      expect(api.fetchDashboardAlerts).toHaveBeenCalledTimes(2);
      expect(api.fetchDashboardAlerts).toHaveBeenLastCalledWith({ zoneId: null }, { background: true });
      expect(await screen.findByRole("link", { name: /Today's bookings/ })).toHaveTextContent("19");
      // The requests waiting for confirmation are not on the timer.
      expect(api.fetchBookings).toHaveBeenCalledTimes(listLoads);

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(3));
      expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith(query);
      await waitFor(() => expect(api.fetchDashboardAlerts).toHaveBeenCalledTimes(3));
      expect(api.fetchDashboardAlerts).toHaveBeenLastCalledWith({ zoneId: null });
      await waitFor(() => expect(api.fetchBookings.mock.calls.length).toBeGreaterThan(listLoads));
    });

    it("a date change is an ordinary load; the timer then polls the new date", async () => {
      renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
      await screen.findByRole("link", { name: /Today's bookings/ });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(screen.getByRole("button", { name: "Next day" }));
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith({ date: "2026-10-24", zoneId: null }));

      await minutes(1);
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith({ date: "2026-10-24", zoneId: null }, { background: true }));
      expect(api.fetchDashboardSummary.mock.calls.filter(([q, opts]) => q.date === "2026-10-23" && opts)).toEqual([]);
    });

    it("pauses while the tab is hidden", async () => {
      renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
      await screen.findByRole("link", { name: /Today's bookings/ });
      setVisibility("hidden");
      await minutes(5);
      expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(1);
      expect(api.fetchDashboardAlerts).toHaveBeenCalledTimes(1);

      // Shown again: the focus refetch (an ordinary load: the member came back), then polls every minute.
      setVisibility("visible");
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(2));
      expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith(query);
      await minutes(1);
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(3));
      expect(api.fetchDashboardSummary).toHaveBeenLastCalledWith(query, { background: true });
    });

    it("keeps keyboard focus in the alerts when a poll removes the focused one", async () => {
      const [due, failed] = alerts.data;
      const uncovered = {
        ...due,
        at: "2026-10-23T08:30:00+00:00",
        title: { ar: "زيارة بلا فريق", en: "Visit without a team" },
        entity: { ...due.entity!, id: 5, reference: "TRB-K2M9QX" },
        link: { ...due.link!, path: "/api/v1/admin/bookings/5" },
      };
      api.fetchDashboardAlerts.mockResolvedValue({ ...alerts, data: [due, uncovered, failed] });
      renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
      const open = await screen.findByRole("link", { name: "Open: Confirmation due" });
      act(() => open.focus());

      // A colleague confirmed the request: the next alert takes the focused one's place, and keeps the focus.
      api.fetchDashboardAlerts.mockResolvedValue({ ...alerts, data: [uncovered, failed] });
      await minutes(1);
      await waitFor(() => expect(screen.queryByRole("link", { name: "Open: Confirmation due" })).not.toBeInTheDocument());
      expect(screen.getByRole("link", { name: "Open: Visit without a team" })).toHaveFocus();

      // No alert link left: the card's title takes it.
      api.fetchDashboardAlerts.mockResolvedValue({ ...alerts, data: [failed] });
      await minutes(1);
      await waitFor(() => expect(screen.queryByRole("link", { name: "Open: Visit without a team" })).not.toBeInTheDocument());
      expect(screen.getByText("Alerts that need action")).toHaveFocus();
    });

    it("a failed poll keeps the figures on screen", async () => {
      renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
      await screen.findByRole("link", { name: /Today's bookings/ });
      api.fetchDashboardSummary.mockRejectedValue(new AdminApiError(0, { code: "NETWORK_ERROR", message: "", details: {} }));
      await minutes(1);
      await waitFor(() => expect(api.fetchDashboardSummary).toHaveBeenCalledTimes(2));
      expect(screen.getByRole("link", { name: /Today's bookings/ })).toHaveTextContent("18");
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });
  });

  it("lists the alerts, urgent ones marked, each linking to its booking when that page exists", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    const card = (await screen.findByRole("heading", { name: "Alerts that need action" })).closest("section")!;
    expect(await within(card).findByText("Confirmation due")).toBeInTheDocument();
    expect(within(card).getByText("Urgent")).toBeInTheDocument();
    expect(within(card).getByText("2 alerts · 1 urgent")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Open: Confirmation due" })).toHaveAttribute("href", "/admin/bookings/4");
    // Payment pages come with A09: the alert is listed without a link.
    expect(within(card).getByText("Payment failed")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Open: Payment failed" })).not.toBeInTheDocument();
  });

  it("shows the panels and the requests waiting for confirmation", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "schedule.view"] });
    expect(await screen.findByRole("meter", { name: "Available" })).toHaveAttribute("aria-valuenow", "9");
    expect(screen.getByRole("meter", { name: "Morning · seats used" })).toHaveAttribute("aria-valuenow", "10");
    expect(screen.getByText("1 uncovered")).toBeInTheDocument();
    expect(screen.getByText("4 of 20 cleaner places booked")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Review TRB-R4RYSD" })).toHaveAttribute("href", "/admin/bookings/4");
    expect(api.fetchBookings).toHaveBeenCalledWith({ status: "pending_confirmation", zoneId: null, page: 1, perPage: 5 });
  });

  it("shows the cancellation reviews from the summary's card, without a bookings list call of its own", async () => {
    api.fetchDashboardSummary.mockResolvedValue(
      dashboardSummary({
        cancellation_reviews: {
          label: { ar: "طلبات إلغاء بانتظار المراجعة", en: "Cancellations waiting for review" },
          value: 2,
          oldest_request: {
            booking_id: 812,
            reference: "TRB-7Q2M9K",
            requested_at: "2026-10-23T14:00:00+00:00",
            waiting_minutes: 120,
            link: { list: "booking", path: "/api/v1/admin/bookings/812", params: {} },
          },
          link: { list: "bookings", path: "/api/v1/admin/bookings", params: { cancel_review: 1 } },
        },
      }),
    );
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "payments.view", "refunds.create"] });
    const card = (await screen.findByRole("heading", { name: "Cancellations waiting for review" })).closest("section")!;
    expect(within(card).getByRole("link", { name: "All reviews (2)" })).toHaveAttribute("href", "/admin/bookings?cancel_review=1");
    expect(within(card).getByRole("link", { name: "Open TRB-7Q2M9K" })).toHaveAttribute("href", "/admin/bookings/812");
    expect(card).toHaveTextContent("for 2 hours");
    // The only bookings list on the page is the pending queue: the review card reads the summary.
    await waitFor(() => expect(api.fetchBookings).toHaveBeenCalled());
    expect(api.fetchBookings.mock.calls).toEqual([[{ status: "pending_confirmation", zoneId: null, page: 1, perPage: 5 }]]);
  });

  it("has no review card when the summary sends none (viewers who don't act on reviews)", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "bookings.cancel", "refunds.create"] });
    await screen.findByRole("link", { name: /Today's bookings/ });
    expect(screen.queryByText("Cancellations waiting for review")).not.toBeInTheDocument();
  });

  const requestsCard = {
    label: { ar: "طلبات الاشتراك", en: "Subscription requests" },
    value: 2,
    overdue: 1,
    next_deadline: {
      subscription_id: 31,
      reference: "TRS-7K2M9Q",
      deadline_at: "2026-10-23T12:00:00+00:00",
      minutes_left: 90,
      link: { list: "subscription", path: "/api/v1/admin/subscriptions/31", params: {} },
    },
    oldest_request: {
      subscription_id: 29,
      reference: "TRS-A1B2C3",
      pending_since: "2026-10-23T05:00:00+00:00",
      waiting_minutes: 300,
      link: { list: "subscription", path: "/api/v1/admin/subscriptions/29", params: {} },
    },
    link: { list: "subscriptions", path: "/api/v1/admin/subscriptions", params: { status: "pending_confirmation", zone_id: 2 } },
  };

  it("shows the subscription requests card with links to A08 for holders of the subscription permissions", async () => {
    api.fetchDashboardSummary.mockResolvedValue(dashboardSummary({ subscription_requests: requestsCard }));
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.view"] });
    const card = (await screen.findByRole("heading", { name: "Subscription requests" })).closest("section")!;
    expect(within(card).getByRole("link", { name: "All requests (2)" })).toHaveAttribute("href", "/admin/subscriptions?status=pending_confirmation&zone_id=2");
    expect(within(card).getByRole("link", { name: "Open TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(card).getByRole("link", { name: "Open TRS-A1B2C3" })).toHaveAttribute("href", "/admin/subscriptions/29");
    expect(card).toHaveTextContent("Next deadline: TRS-7K2M9Q, in 1 hour 30 minutes");
    expect(card).toHaveTextContent("Waiting longest: TRS-A1B2C3, for 5 hours");
    expect(card).toHaveTextContent("1 request past the deadline");
  });

  it("says when a subscription deadline has passed and when none is waiting", async () => {
    api.fetchDashboardSummary.mockResolvedValue(
      dashboardSummary({ subscription_requests: { ...requestsCard, value: 1, overdue: 1, next_deadline: { ...requestsCard.next_deadline, minutes_left: -20 } } }),
    );
    const { unmount } = renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.manage"] });
    const card = (await screen.findByRole("heading", { name: "Subscription requests" })).closest("section")!;
    expect(card).toHaveTextContent("The deadline of TRS-7K2M9Q passed 20 minutes ago");
    unmount();
    api.fetchDashboardSummary.mockResolvedValue(
      dashboardSummary({ subscription_requests: { ...requestsCard, value: 0, overdue: 0, next_deadline: null, oldest_request: null } }),
    );
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.manage"] });
    expect(await screen.findByText("No subscription request is waiting for confirmation.")).toBeInTheDocument();
  });

  it("has no subscription card when the summary sends none", async () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view"] });
    await screen.findByRole("link", { name: /Today's bookings/ });
    expect(screen.queryByText("Subscription requests")).not.toBeInTheDocument();
  });

  it("shows the subscriptions cancelled today next to the booking cancellations", async () => {
    const base = dashboardSummary();
    api.fetchDashboardSummary.mockResolvedValue({
      ...base,
      quick_stats: { ...base.quick_stats, subscriptions_cancelled: { total: 3, customer: 1, staff: 1, system: 1 } },
    });
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view"] });
    const stat = (await screen.findByText("Subscriptions cancelled today")).parentElement!;
    expect(stat).toHaveTextContent("3");
    expect(stat).toHaveTextContent("Customer 1 · Staff 1 · System 1");
    expect(screen.getByText("Cancellations today")).toBeInTheDocument();
  });

  it("opens a subscription alert in A08, from its link or its entity", async () => {
    api.fetchDashboardAlerts.mockResolvedValue({
      ...alerts,
      data: [
        {
          type: "subscription_renewal_failed",
          severity: "urgent",
          at: "2026-10-23T08:00:00+00:00",
          title: { ar: "فشل التجديد", en: "Renewal failed" },
          message: { ar: "…", en: "TRS-7K2M9Q is suspended." },
          entity: { type: "subscription", id: 31, reference: "TRS-7K2M9Q" },
          link: { list: "subscription", path: "/api/v1/admin/subscriptions/31", params: {} },
          details: {},
        },
        {
          type: "subscription_conflict",
          severity: "warning",
          at: "2026-10-23T09:00:00+00:00",
          title: { ar: "تعارض", en: "Visit conflict" },
          message: { ar: "…", en: "A visit of TRS-A1B2C3 has a conflict." },
          entity: { type: "subscription", id: 29, reference: "TRS-A1B2C3" },
          link: null,
          details: {},
        },
      ],
    });
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.view"] });
    expect(await screen.findByRole("link", { name: /Renewal failed/ })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(screen.getByRole("link", { name: /Visit conflict/ })).toHaveAttribute("href", "/admin/subscriptions/29");
  });

  it("opens A08's cancellation review queue beside the subscription_cancel_review alerts", async () => {
    const review = (id: number, reference: string): DashboardAlerts["data"][number] => ({
      type: "subscription_cancel_review",
      severity: "warning",
      at: "2026-10-23T07:00:00+00:00",
      title: { ar: "مراجعة إلغاء", en: "Cancellation to review" },
      message: { ar: "…", en: `The cancellation of ${reference} waits for review.` },
      entity: { type: "subscription", id, reference },
      link: { list: "subscription", path: `/api/v1/admin/subscriptions/${id}`, params: {} },
      details: {},
    });
    const withReviews: DashboardAlerts = {
      data: [review(31, "TRS-7K2M9Q"), review(29, "TRS-A1B2C3")],
      meta: { ...alerts.meta, types: ["subscription_cancel_review"], counts: { subscription_cancel_review: 3 }, total: 3, urgent: 0 },
    };
    api.fetchDashboardAlerts.mockResolvedValue(withReviews);
    const first = renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.view"] });
    // The count is the full number (meta.counts), not only the alerts listed.
    const queue = await screen.findByRole("link", { name: "Subscription cancellations waiting for review (3)" });
    expect(queue).toHaveAttribute("href", "/admin/subscriptions?cancel_review=1");
    expect(screen.getAllByRole("link", { name: /Cancellation to review/ }).map((a) => a.getAttribute("href"))).toEqual([
      "/admin/subscriptions/31",
      "/admin/subscriptions/29",
    ]);
    first.unmount();

    // None waiting: no queue link.
    api.fetchDashboardAlerts.mockResolvedValue(alerts);
    const second = renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view", "subscriptions.view"] });
    expect(await screen.findByText("Confirmation due")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Subscription cancellations waiting for review/ })).not.toBeInTheDocument();
    second.unmount();

    // No A08 permission: the alerts stay, the queue link does not.
    api.fetchDashboardAlerts.mockResolvedValue(withReviews);
    renderWithProviders(<OverviewScreen />, { permissions: ["bookings.view"] });
    expect(await screen.findAllByText("Cancellation to review")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Subscription cancellations waiting for review/ })).not.toBeInTheDocument();
  });

  it("welcomes staff without bookings or schedule access instead of loading figures", () => {
    renderWithProviders(<OverviewScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText("Welcome to Tarteeba operations")).toBeInTheDocument();
    expect(api.fetchDashboardSummary).not.toHaveBeenCalled();
  });
});
