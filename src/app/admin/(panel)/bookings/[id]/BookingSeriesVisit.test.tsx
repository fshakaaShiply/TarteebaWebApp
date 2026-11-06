import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isolate } from "@/lib/admin/format";
import type { RescheduleRequest } from "@/lib/admin/types";
import { bookingDetail, serviceOptions, visitCandidates, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { BookingDetailScreen } from "./BookingDetailScreen";

const api = { fetchBooking: vi.fn(), fetchVisitCandidates: vi.fn(), fetchRefundsByPhone: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchBooking: (...a: unknown[]) => api.fetchBooking(...a),
  fetchVisitCandidates: (...a: unknown[]) => api.fetchVisitCandidates(...a),
  fetchRefundsByPhone: (...a: unknown[]) => api.fetchRefundsByPhone(...a),
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
}));

const STAFF = ["bookings.view", "bookings.confirm", "bookings.reschedule", "bookings.cancel", "schedule.view", "subscriptions.manage"];
const link = { id: 31, ulid: "01jb", reference: "TRS-7K2M9Q", type: "recurring", visit_no: 3, visits_total: 8, period_no: 1 };

/** Text without the bidi isolates around names and references. */
const plain = (el: Element) => (el.textContent ?? "").replace(/[\u2066-\u2069]/g, "");

const seriesVisit = (over = {}) =>
  bookingDetail({ status: "confirmed", payment_status: "captured", kind: "subscription_visit", subscription: link, ...over });

/** A customer's move of the visit waiting for staff (MoveSeriesVisitBooking leaves it pending when approval is needed). */
const pendingRequest: RescheduleRequest = {
  id: 77,
  ulid: "01jrq",
  status: "pending",
  status_label: { ar: "بانتظار القرار", en: "Pending" },
  from: { service_date: "2026-11-03", slot: { id: 1, name: { ar: "صباحية", en: "Morning" }, start: "10:00", end: "14:00" } },
  to: { service_date: "2026-11-04", slot: { id: 1, name: { ar: "صباحية", en: "Morning" }, start: "10:00", end: "14:00" } },
  fee_fils: 0,
  price_diff_fils: 0,
  new_total_fils: 24000,
  decision_note: null,
  decided_at: null,
  created_at: "2026-10-23T10:00:00+00:00",
  booking_id: 4,
  booking_reference: "TRB-K2M9QX",
  requested_by_type: "customer",
  requested_by_id: 3,
  reason: null,
  rule_applied: "series_move",
  override: null,
  decided_by: null,
};
const requestsCard = async () => (await screen.findByRole("heading", { name: "Reschedule requests" })).closest("section") as HTMLElement;

describe("A03 booking page of a subscription visit", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchRefundsByPhone.mockResolvedValue([]);
    api.fetchVisitCandidates.mockResolvedValue({ visit: null, candidates: [] });
  });

  it("names the subscription and the visit's place, and sends staff there instead of cancel and reschedule", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit());
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const title = await screen.findByRole("heading", { level: 1 });
    const header = title.closest("section") as HTMLElement;
    expect(header).toHaveTextContent("Subscription TRS-7K2M9Q · visit 3 of 8");
    expect(within(header).getByText(/This visit belongs to a subscription/)).toBeInTheDocument();
    const open = within(header).getAllByRole("link", { name: /Open subscription TRS-7K2M9Q/ });
    expect(open.length).toBeGreaterThan(0);
    for (const a of open) expect(a).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(header).queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: "Reschedule" })).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: /^Cancel/ })).not.toBeInTheDocument();
  });

  it("says the visit is paid within its subscription's period, never 'No payment yet' and AED 0 (P4-38)", async () => {
    // A series visit has no money of its own: payment null, every amount 0, payment_status captured.
    const zero = { subtotal_fils: 0, addons_fils: 0, discount_fils: 0, net_fils: 0, vat_rate_bp: 500, vat_fils: 0, total_fils: 0, currency: "AED" };
    api.fetchBooking.mockResolvedValue(seriesVisit({ payment: null, amounts: zero, lines: [], subscription: { ...link, type: "live_out", period_no: 1 } }));
    const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const payment = (await screen.findByRole("heading", { name: "Payment and refunds" })).closest("section") as HTMLElement;
    expect(plain(payment)).toContain("Paid within subscription TRS-7K2M9Q (period 1).");
    expect(payment).not.toHaveTextContent("No payment yet");
    const price = screen.getByRole("heading", { name: "Price" }).closest("section") as HTMLElement;
    expect(plain(price)).toContain("Included in subscription TRS-7K2M9Q, period 1");
    expect(price).not.toHaveTextContent("AED 0");
    unmount();

    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    const arabic = (await screen.findByRole("heading", { name: "الدفع والاسترداد" })).closest("section") as HTMLElement;
    expect(arabic).toHaveTextContent("مدفوعة ضمن الاشتراك");
    expect(arabic).toHaveTextContent("(الفترة 1)");
  });

  it("labels the reasons Phase 4 writes on a series visit: history, the Ended line and the cancellation reason", async () => {
    const at = "2026-11-06T10:54:00+00:00";
    const row = { visit_id: null, actor_id: null, meta: null };
    api.fetchBooking.mockResolvedValue(
      seriesVisit({
        status: "cancelled",
        payment: null,
        cancelled_at: at,
        cancel_reason_code: "subscription_cancelled",
        cancelled_by_type: "customer",
        cancellation: { party: "customer", cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: null, review: null },
        history: [
          { ...row, id: 2, scope: "booking", from_status: "confirmed", to_status: "cancelled", actor_type: "customer", reason: "subscription_cancelled", created_at: at },
          { ...row, id: 1, scope: "visit", visit_id: 4, from_status: "scheduled", to_status: "worker_assigned", actor_type: "system", reason: "series_primary", created_at: "2026-11-06T10:53:00+00:00" },
        ],
      }),
    );
    const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(header).toHaveTextContent("Ended: Subscription cancelled · 6 Nov 2026, 14:54");
    const history = screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement;
    expect(history).toHaveTextContent("System · Assigned from the subscription");
    expect(history).toHaveTextContent("Subscription cancelled");
    const payment = screen.getByRole("heading", { name: "Payment and refunds" }).closest("section") as HTMLElement;
    expect(payment).toHaveTextContent("ReasonSubscription cancelled");
    expect(document.body).not.toHaveTextContent(/subscription_cancelled|series_primary/);
    unmount();

    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    await screen.findByRole("heading", { level: 1 });
    expect(document.body).toHaveTextContent("أُلغي الاشتراك");
    expect(document.body).toHaveTextContent("عُيّنت من الاشتراك");
    expect(document.body).not.toHaveTextContent(/subscription_cancelled|series_primary/);
  });

  it("calls the worker the subscription's primary, without the 'not promised' copy of a preferred cleaner", async () => {
    const maria = { id: 14, display_name: "Maria S." };
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(0));
    api.fetchBooking.mockResolvedValue(seriesVisit({ preferred_worker: maria, subscription: { ...link, type: "live_out" } }));
    const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    await screen.findByRole("heading", { level: 1 });
    expect(await screen.findByText("Subscription's primary worker: \u2068Maria S.\u2069")).toBeInTheDocument();
    expect(screen.getByText("Booked for the whole day.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/not promised|isn't promised|Maria S\.\./);
    unmount();

    // A single booking keeps the preferred cleaner's wording, and her name no longer ends a sentence ("Maria S..").
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured", preferred_worker: maria }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    expect(await screen.findByText(/Preferred cleaner: \u2068Maria S\.\u2069 — we try/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Maria S..");
  });

  it("badges the subscription's primary among the candidates as the subscription's, never as the customer's wish", async () => {
    const maria = { id: 1, display_name: "Maria S." };
    const list = visitCandidates(2);
    // As the API ranks her: preferred, with the rank reason it gives any booking's preferred worker.
    const asked = { code: "preferred_worker", label: { ar: "طلب العميل هذه العاملة.", en: "The customer asked for this worker." } };
    list.candidates[0] = { ...list.candidates[0], preferred: true, reasons: [asked, ...list.candidates[0].reasons] };
    api.fetchVisitCandidates.mockResolvedValue(list);
    api.fetchBooking.mockResolvedValue(seriesVisit({ preferred_worker: maria }));
    const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const cleaners = (await screen.findByRole("heading", { name: "Cleaners" })).closest("section") as HTMLElement;
    const row = (await within(cleaners).findByText("Maria S.")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Subscription's primary");
    expect(row).toHaveTextContent("The primary worker of this subscription.");
    expect(cleaners).not.toHaveTextContent(/Customer's preferred|The customer asked for this worker/);
    unmount();

    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    const arabic = (await screen.findByText("Maria S.", { selector: "li bdi" })).closest("li") as HTMLElement;
    expect(arabic).toHaveTextContent("الأساسية في الاشتراك");
    expect(arabic).toHaveTextContent("العاملة الأساسية في هذا الاشتراك.");
    expect(document.body).not.toHaveTextContent(/المفضلة لدى العميل|طلب العميل هذه العاملة/);
  });

  it("keeps the customer's preferred wording among a single booking's candidates", async () => {
    const list = visitCandidates(2);
    const asked = { code: "preferred_worker", label: { ar: "طلب العميل هذه العاملة.", en: "The customer asked for this worker." } };
    list.candidates[0] = { ...list.candidates[0], preferred: true, reasons: [asked, ...list.candidates[0].reasons] };
    api.fetchVisitCandidates.mockResolvedValue(list);
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured", preferred_worker: { id: 1, display_name: "Maria S." } }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const cleaners = (await screen.findByRole("heading", { name: "Cleaners" })).closest("section") as HTMLElement;
    const row = (await within(cleaners).findByText("Maria S.")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Customer's preferred");
    expect(row).toHaveTextContent("The customer asked for this worker.");
  });

  it("labels the reasons a series visit's moves, misses and no-shows write, in history, the Ended line and the cancellation reason", async () => {
    const at = "2026-11-06T10:54:00+00:00";
    const row = { visit_id: null, actor_id: null, meta: null };
    api.fetchBooking.mockResolvedValue(
      seriesVisit({
        status: "cancelled",
        payment: null,
        cancelled_at: at,
        cancel_reason_code: "missed_by_company",
        cancelled_by_type: "system",
        cancellation: { party: "company", cancelled_by_id: null, fee_fils: null, refund_fils: null, review_requested_at: null, review: null },
        history: [
          { ...row, id: 6, scope: "booking", from_status: "confirmed", to_status: "cancelled", actor_type: "system", reason: "missed_by_company", created_at: at },
          { ...row, id: 5, scope: "visit", visit_id: 4, from_status: "worker_assigned", to_status: "en_route", actor_type: "driver", reason: "round_departed", created_at: "2026-11-06T06:00:00+00:00" },
          { ...row, id: 4, scope: "booking", from_status: "confirmed", to_status: "completed", actor_type: "system", reason: "no_show_customer", created_at: "2026-11-05T10:00:00+00:00" },
          { ...row, id: 3, scope: "booking", from_status: "confirmed", to_status: "rescheduled", actor_type: "staff", reason: "staff_reschedule", created_at: "2026-11-04T10:00:00+00:00" },
          { ...row, id: 2, scope: "booking", from_status: "rescheduled", to_status: "confirmed", actor_type: "staff", reason: "reschedule_applied", created_at: "2026-11-04T10:00:00+00:00" },
          { ...row, id: 1, scope: "booking", from_status: "confirmed", to_status: "rescheduled", actor_type: "customer", reason: "customer_reschedule", created_at: "2026-11-03T10:00:00+00:00" },
        ],
      }),
    );
    const raw = /missed_by_company|no_show_customer|customer_reschedule|staff_reschedule|round_departed/;
    const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(header).toHaveTextContent("Ended: Visit missed · 6 Nov 2026, 14:54");
    const history = screen.getByRole("heading", { name: "History" }).closest("section") as HTMLElement;
    for (const label of ["System · Visit missed", "Driver · Round departed", "System · Customer not available", "Staff · Moved by our team", "Customer · Moved at the customer's request"]) {
      expect(history).toHaveTextContent(label);
    }
    const payment = screen.getByRole("heading", { name: "Payment and refunds" }).closest("section") as HTMLElement;
    expect(payment).toHaveTextContent("ReasonVisit missed");
    expect(document.body).not.toHaveTextContent(raw);
    unmount();

    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    await screen.findByRole("heading", { level: 1 });
    for (const label of ["لم تتم الزيارة", "انطلقت الجولة", "العميل غير متواجد", "نقله فريقنا", "نُقل بطلب من العميل"]) expect(document.body).toHaveTextContent(label);
    expect(document.body).not.toHaveTextContent(raw);
  });

  it("keeps cancel and reschedule on a single booking, with no subscription notice", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured" }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(within(header).getByRole("button", { name: /Reschedule/ })).toBeInTheDocument();
    expect(within(header).queryByText(/belongs to a subscription/)).not.toBeInTheDocument();
  });

  it("sends a series visit's pending reschedule request to the subscription instead of offering Approve and Reject", async () => {
    // DecideRescheduleRequest refuses both for a series visit (409 USE_SUBSCRIPTION_ACTIONS): A08 decides it.
    api.fetchBooking.mockResolvedValue(seriesVisit({ reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const card = await requestsCard();
    expect(card).toHaveTextContent("approved or declined on the subscription page");
    expect(within(card).getByRole("link", { name: "Open subscription TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("names the subscription page without a link to staff who cannot open A08", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit({ reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view", "bookings.reschedule"] });
    const card = await requestsCard();
    expect(card).toHaveTextContent("approved or declined on the subscription page");
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("keeps Approve and Reject on a single booking's pending request", async () => {
    api.fetchBooking.mockResolvedValue(bookingDetail({ status: "confirmed", payment_status: "captured", reschedule_requests: [pendingRequest] }));
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
    const card = await requestsCard();
    expect(within(card).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("subscription page");
  });

  it("names a Live-out day with the admin's own Arabic term (Live-out), as the design does", async () => {
    api.fetchBooking.mockResolvedValue(
      seriesVisit({ kind: "live_out_day", subscription: { ...link, type: "live_out", visit_no: 5, visits_total: 26, period_no: 1 } }),
    );
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF, locale: "ar" });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(header.textContent).toMatch(/Live-out TRS-7K2M9Q · اليوم (5|٥) من (26|٢٦)/);
    expect(header).not.toHaveTextContent("إقامة");
  });

  it("says who serves a Live-out day her primary is absent from, never 'Booked for the whole day' (TRB-MH52SZ, 17 Nov)", async () => {
    const maria = { id: 14, display_name: "Maria S." };
    const siti = { worker_id: 21, display_name: "Siti R.", role: "primary", assigned_at: "2026-11-16T10:00:00+00:00" };
    const visit = { ...bookingDetail().visits[0], status: "worker_assigned" as const, assignments: [siti] };
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(0));
    api.fetchBooking.mockResolvedValue(
      seriesVisit({ kind: "live_out_day", workers_count: 1, preferred_worker: maria, subscription: { ...link, type: "live_out" }, visits: [visit] }),
    );
    const { unmount } = renderWithProviders(<BookingDetailScreen id="33" />, { permissions: STAFF });
    await screen.findByRole("heading", { level: 1 });
    expect(await screen.findByText(`Not serving this day; serving: ${isolate("Siti R.")}.`)).toBeInTheDocument();
    expect(screen.queryByText("Booked for the whole day.")).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<BookingDetailScreen id="33" />, { permissions: STAFF, locale: "ar" });
    expect(await screen.findByText(`لا تخدم هذا اليوم؛ تخدمه: ${isolate("Siti R.")}.`)).toBeInTheDocument();
    expect(screen.queryByText("محجوزة طوال اليوم.")).not.toBeInTheDocument();
  });

  it("keeps 'Booked for the whole day' for the day she serves, and drops it on a day that will not take place", async () => {
    const maria = { id: 14, display_name: "Maria S." };
    const own = { worker_id: 14, display_name: "Maria S.", role: "primary", assigned_at: "2026-11-16T10:00:00+00:00" };
    const visit = { ...bookingDetail().visits[0], status: "worker_assigned" as const, assignments: [own] };
    api.fetchVisitCandidates.mockResolvedValue(visitCandidates(0));
    const day = (over = {}) =>
      seriesVisit({ kind: "live_out_day", workers_count: 1, preferred_worker: maria, subscription: { ...link, type: "live_out" }, visits: [visit], ...over });
    api.fetchBooking.mockResolvedValue(day());
    const { unmount } = renderWithProviders(<BookingDetailScreen id="33" />, { permissions: STAFF });
    expect(await screen.findByText("Booked for the whole day.")).toBeInTheDocument();
    expect(screen.queryByText(/Not serving this day/)).not.toBeInTheDocument();
    unmount();

    api.fetchBooking.mockResolvedValue(day({ status: "cancelled", visits: [{ ...visit, status: "cancelled", assignments: [] }] }));
    renderWithProviders(<BookingDetailScreen id="33" />, { permissions: STAFF });
    expect(await screen.findByText("Named for the subscription's visits; she is changed on the subscription page.")).toBeInTheDocument();
    expect(screen.queryByText("Booked for the whole day.")).not.toBeInTheDocument();
  });

  it("says a visit of a refunded period was refunded, in the header chip and the payment card, not 'Paid' (TRS-2FZEJE, P4-264)", async () => {
    const cancelled = { ...bookingDetail().visits[0], status: "cancelled" as const, assignments: [] };
    api.fetchBooking.mockResolvedValue(
      seriesVisit({ status: "cancelled", payment: null, visits: [cancelled], subscription: { ...link, period_status: "refunded" as const } }),
    );
    const { unmount } = renderWithProviders(<BookingDetailScreen id="2" />, { permissions: STAFF });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(header).toHaveTextContent("Payment: Refunded");
    expect(header).not.toHaveTextContent("Payment: Paid");
    const payment = screen.getByRole("heading", { name: "Payment and refunds" }).closest("section") as HTMLElement;
    expect(plain(payment)).toContain("Refunded with subscription TRS-7K2M9Q (period 1).");
    expect(payment).not.toHaveTextContent("Paid within");
    unmount();

    renderWithProviders(<BookingDetailScreen id="2" />, { permissions: STAFF, locale: "ar" });
    const arabic = (await screen.findByRole("heading", { name: "الدفع والاسترداد" })).closest("section") as HTMLElement;
    expect(plain(arabic)).toContain("مستردة مع الاشتراك TRS-7K2M9Q (الفترة 1).");
    expect(arabic).not.toHaveTextContent("مدفوعة ضمن الاشتراك");
    expect((screen.getByRole("heading", { level: 1 }).closest("section") as HTMLElement)).toHaveTextContent("الدفع: تم الاسترداد");
  });

  it("words a series visit's payment by each state of its period: partly refunded, not paid yet, never paid, paid", async () => {
    const cases: [string, string, string][] = [
      ["refunded_partial", "Paid within subscription TRS-7K2M9Q (period 1); part of the period was refunded.", "Payment: Partially refunded"],
      ["upcoming", "Not paid yet: period 1 of subscription TRS-7K2M9Q.", "Payment: Unpaid"],
      ["pending_payment", "Not paid yet: period 1 of subscription TRS-7K2M9Q.", "Payment: Awaiting payment"],
      ["failed", "Not paid yet: period 1 of subscription TRS-7K2M9Q.", "Payment: Unpaid"],
      ["void", "Not paid: period 1 of subscription TRS-7K2M9Q was never paid.", "Payment: Payment cancelled"],
      ["paid", "Paid within subscription TRS-7K2M9Q (period 1).", "Payment: Paid"],
      ["closed", "Paid within subscription TRS-7K2M9Q (period 1).", "Payment: Paid"],
    ];
    for (const [status, sentence, chip] of cases) {
      api.fetchBooking.mockResolvedValue(seriesVisit({ payment: null, subscription: { ...link, period_status: status } }));
      const { unmount } = renderWithProviders(<BookingDetailScreen id="4" />, { permissions: STAFF });
      const payment = (await screen.findByRole("heading", { name: "Payment and refunds" })).closest("section") as HTMLElement;
      expect(plain(payment), status).toContain(sentence);
      expect(screen.getByRole("heading", { level: 1 }).closest("section"), status).toHaveTextContent(chip);
      unmount();
    }
  });

  it("says no cleaner will come to a cancelled visit, without 'yet'", async () => {
    const cancelled = { ...bookingDetail().visits[0], status: "cancelled" as const, assignments: [] };
    api.fetchBooking.mockResolvedValue(seriesVisit({ status: "cancelled", payment: null, visits: [cancelled] }));
    const { unmount } = renderWithProviders(<BookingDetailScreen id="2" />, { permissions: STAFF });
    const cleaners = (await screen.findByRole("heading", { name: "Cleaners" })).closest("section") as HTMLElement;
    expect(cleaners).toHaveTextContent("No cleaner: this visit will not take place.");
    expect(cleaners).not.toHaveTextContent(/assigned yet/);
    unmount();

    renderWithProviders(<BookingDetailScreen id="2" />, { permissions: STAFF, locale: "ar" });
    const arabic = (await screen.findByRole("heading", { name: "العاملات" })).closest("section") as HTMLElement;
    expect(arabic).toHaveTextContent("لا عاملة: لن تتم هذه الزيارة.");
    expect(arabic).not.toHaveTextContent("بعد");
  });

  it("shows the notice without a link to staff who cannot open A08", async () => {
    api.fetchBooking.mockResolvedValue(seriesVisit());
    renderWithProviders(<BookingDetailScreen id="4" />, { permissions: ["bookings.view", "bookings.cancel"] });
    const header = (await screen.findByRole("heading", { level: 1 })).closest("section") as HTMLElement;
    expect(within(header).getByText(/This visit belongs to a subscription/)).toBeInTheDocument();
    expect(within(header).queryByRole("link", { name: /Open subscription/ })).not.toBeInTheDocument();
  });
});
