import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { event, subscriptionDetail } from "@/test/subscriptionFixtures";
import { HistoryTab } from "./DetailParts";

const api = vi.hoisted(() => ({ fetchSubscriptionEvents: vi.fn() }));
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const meta = { current_page: 1, per_page: 50, total: 7, last_page: 1 };
const system = { type: "system", id: null, name: null };
const staff = { type: "staff", id: 2, name: "Coordinator" };
const siti = { id: 2, name: "Siti R." };
const maria = { id: 1, name: "Maria S." };

/** The rows of the walk-through (TRS-C7H810 and TRL-S2FB7Q), period ids as the fixture's (201 = period 1). */
const rows = () => [
  event({
    id: 17,
    type: "cancel",
    type_label: "Cancelled",
    actor: { type: "customer", id: 11, name: "Sara Ahmed" },
    payload: { to: "cancelled", from: "active", party: "customer", periods: [{ ulid: "01m6r7", refund_fils: 91201 }], fee_fils: 0, reason_code: "plans_changed", refund_fils: 182402, clawback_fils: 0 },
    workers: [],
  }),
  event({
    id: 13,
    type: "renewal_failed",
    type_label: "Renewal failed",
    actor: system,
    payload: { to: "renewal_failed", code: "card_declined", from: "active", period_id: 201, scheduled: true, attempt_no: 1, payment_id: 2 },
    workers: [],
  }),
  event({ id: 11, type: "renewal_priced", type_label: "Renewal priced", actor: system, payload: { period_id: 201, renewal_at: "2026-12-07T06:00:00+00:00", amount_fils: 91201 }, workers: [] }),
  event({
    id: 10,
    type: "payment_method_changed",
    type_label: "Card changed",
    actor: { type: "customer", id: 11, name: "Sara Ahmed" },
    payload: { card: "Visa •••• 0002", consent_version: "2026-10", to_payment_method_id: 2, from_payment_method_id: 1 },
    workers: [],
  }),
  event({
    id: 9,
    type: "series_edited",
    type_label: "Following visits changed",
    actor: staff,
    payload: {
      new: ["2026-11-30", "2026-12-03", "2026-12-07"],
      from: "2026-11-29",
      kept: [],
      after: { days_of_week: [1, 4], pattern_from: "2026-11-29", rest_weekdays: null, slot_template_id: 1 },
      before: { days_of_week: [0, 3], pattern_from: "2026-11-08", rest_weekdays: null, slot_template_id: 1 },
      replaced: ["2026-11-29", "2026-12-02", "2026-12-06"],
      term_end_date: "2026-12-09",
    },
    workers: [],
  }),
  event({
    id: 24,
    type: "worker_changed",
    type_label: "Worker changed",
    actor: staff,
    payload: { date: "2026-11-17", added: [2], reason: "live_out_absence", removed: [1], workers: [2], visit_id: 33, booking_id: 33 },
    workers: [siti, maria],
  }),
  event({
    id: 21,
    type: "live_out_day_changed",
    type_label: "Full day changed",
    actor: staff,
    payload: {
      to: "2026-11-17", from: "2026-11-17", dates: ["2026-11-17"], scope: "this", unfit: [], change: "absence", appended: [], credited: [],
      term_end_date: { to: "2026-12-07", from: "2026-12-07" }, substitute_worker_id: 2,
    },
    workers: [siti],
  }),
];

const plain = (el: HTMLElement) => (el.textContent ?? "").replace(/[\u2066-\u2069]/g, "");

async function history(locale: "en" | "ar") {
  renderWithProviders(<HistoryTab subscription={subscriptionDetail()} />, { permissions: ["subscriptions.view"], locale });
  return (await screen.findByRole("list", { name: locale === "ar" ? "السجل" : "History" })) as HTMLElement;
}

describe("A08 history line", () => {
  beforeEach(() => {
    api.fetchSubscriptionEvents.mockReset();
    api.fetchSubscriptionEvents.mockResolvedValue({ data: rows(), meta });
  });

  it("says in words what each row did: labelled statuses and reasons, worker names, Dubai times, no ids or codes", async () => {
    const list = await history("en");
    const text = plain(list);
    for (const line of [
      "Status: Active → Cancelled",
      "Cancelled by: Customer",
      "Reason: Plans changed",
      "Failure: Card declined",
      "Period: 1",
      "Attempt: 1, scheduled",
      "Renewal: 7 Dec 2026, 10:00",
      "Card: Visa •••• 0002",
      "Days: Sun, Wed → Mon, Thu",
      "New dates: Mon, 30 Nov 2026, Thu, 3 Dec 2026, Mon, 7 Dec 2026",
      "End of the term: Wed, 9 Dec 2026",
      "Visit: Tue, 17 Nov 2026",
      "Added: Siti R.",
      "Taken off: Maria S.",
      "Reason: Live-out absence",
      "Change: Absence",
      "Applies to: This day only",
      "Substitute: Siti R.",
    ]) {
      expect(text, line).toContain(line);
    }
    expect(text).toMatch(/Refund: AED 1,?824\.02/);
    // Nothing raw: no snake_case codes, ids, UTC instants, booleans or zero amounts nobody paid.
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(text).not.toMatch(/T06:00|\+00:00|\byes\b|\bno\b|worker id|clawback|Fee:|\b33\b/i);
    // Each name is its own bidi run.
    expect(list.textContent).toContain("\u2068Siti R.\u2069");
  });

  it("reads fully Arabic in Arabic, with Arabic list commas and the name's period kept with the name", async () => {
    const list = await history("ar");
    const text = plain(list);
    for (const line of ["السبب: تغيرت الخطط", "صاحب الإلغاء: العميل", "سبب الفشل: رُفضت البطاقة", "السبب: غياب في Live-out", "يسري على: هذا اليوم فقط", "التجديد: 7 ديسمبر 2026"]) {
      expect(text, line).toContain(line);
    }
    expect(text).toContain("، ");
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(text).not.toMatch(/\b(party|code|scope|change|period|attempt|renewal|scheduled|yes|no)\b/);
    expect(list.textContent).toContain("\u2068Maria S.\u2069");
  });
});
