import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { serviceOptions, slotTemplateOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { event, liveOutDetail, novemberCalendar, occurrence, pendingDetail, subscriptionDetail, subscriptionPeriod } from "@/test/subscriptionFixtures";
import { SubscriptionDetailScreen } from "./SubscriptionDetailScreen";

const api = vi.hoisted(() => {
  const names = ["fetchSubscription", "fetchSubscriptionVisits", "fetchSubscriptionCalendar", "fetchSubscriptionEvents", "fetchWorkerCandidates", "previewFreeze", "previewConfirm", "previewCancel"];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
const shared = vi.hoisted(() => ({ fetchAddonOptions: vi.fn() }));
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotTemplateOptions,
  fetchAddonOptions: (...a: unknown[]) => shared.fetchAddonOptions(...a),
}));

const addonOption = (id: number, code: string, en: string, ar: string) => ({ id, code, name: { ar, en }, amount_fils: 1500, vat_inclusive: true, per: "visit", is_active: true, service_codes: ["STANDARD_VISIT"] });

const MANAGER = ["subscriptions.manage", "bookings.view", "payments.view"];
const READER = ["subscriptions.view"];
const meta = { current_page: 1, per_page: 50, total: 0, last_page: 1 };

function open(detail = subscriptionDetail(), permissions: string[] = MANAGER, locale: "en" | "ar" = "en") {
  api.fetchSubscription.mockResolvedValue(detail);
  return renderWithProviders(<SubscriptionDetailScreen id={String(detail.id)} />, { permissions, locale });
}

describe("A08 subscription page", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchSubscriptionVisits.mockResolvedValue({ data: [occurrence()], meta });
    api.fetchSubscriptionEvents.mockResolvedValue({ data: [event()], meta });
    api.fetchSubscriptionCalendar.mockResolvedValue(novemberCalendar());
    api.fetchWorkerCandidates.mockResolvedValue([]);
    api.previewFreeze.mockReturnValue(new Promise(() => undefined));
    api.previewConfirm.mockReturnValue(new Promise(() => undefined));
    api.previewCancel.mockReturnValue(new Promise(() => undefined));
    shared.fetchAddonOptions.mockReset();
    shared.fetchAddonOptions.mockResolvedValue([addonOption(1, "IRONING", "Ironing", "الكيّ"), addonOption(2, "FRIDGE", "Fridge cleaning", "تنظيف الثلاجة")]);
  });

  it("words the contract's source, materials and add-ons in the admin's language", async () => {
    const detail = subscriptionDetail({ source: "app", materials_by: "company", addons: ["IRONING", "FRIDGE", "OLD_CODE"] });
    const { unmount } = open(detail, MANAGER, "ar");
    const card = (await screen.findByText("العقد")).closest("section") ?? document.body;
    expect(within(card as HTMLElement).getByText("التطبيق")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("الشركة تُحضر مواد التنظيف")).toBeInTheDocument();
    // Names from the add-on list, joined with the Arabic comma; a code the list does not know stays as it is.
    await waitFor(() => expect(within(card as HTMLElement).getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "الكيّ، تنظيف الثلاجة، OLD_CODE")).toBeInTheDocument());
    expect(within(card as HTMLElement).queryByText("app")).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText("company")).not.toBeInTheDocument();
    unmount();

    // Without a permission that reads the add-on list, the codes are shown and the list is not asked for.
    shared.fetchAddonOptions.mockClear();
    open(subscriptionDetail({ addons: ["IRONING"] }), READER);
    expect(await screen.findByText("Customer's own materials")).toBeInTheDocument();
    expect(screen.getByText("IRONING")).toBeInTheDocument();
    expect(shared.fetchAddonOptions).not.toHaveBeenCalled();
  });

  it("shows the reference, the chips, the facts and the tabs of a recurring subscription", async () => {
    open();
    expect(await screen.findByRole("heading", { name: /TRS-7K2M9Q/ })).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sara Ahmed/).length).toBeGreaterThan(0);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Overview", "Visits", "Periods and payments", "History"]);
    // The overview: the weekly pattern, the workers and the next visits.
    expect(screen.getByText("Sunday, Wednesday")).toBeInTheDocument();
    expect(screen.getAllByText("Maria S.").length).toBeGreaterThan(0);
  });

  it("adds the Calendar tab for a Live-out subscription only", async () => {
    open(liveOutDetail());
    await screen.findByRole("heading", { name: /TRS-L0NG01/ });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Visits", "Calendar", "Periods and payments", "History"]);
    expect(screen.getByText("Weekly rest days")).toBeInTheDocument();
  });

  it("shows a pending request's deadline and first visit, and Confirm and Reject to the coordinator only", async () => {
    open(pendingDetail());
    expect(await screen.findByText("Waiting for confirmation")).toBeInTheDocument();
    expect(screen.getByText(/Decide by/)).toBeInTheDocument();
    expect(screen.getByText(/First visit: Sun, 1 Nov 2026, 10:00–14:00\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("offers a reader no action at all, but every tab", async () => {
    open(pendingDetail(), READER);
    await screen.findByText("Waiting for confirmation");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Primary worker" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("says the capture result is unknown and offers to confirm again", async () => {
    const user = userEvent.setup();
    open(pendingDetail({ capture_unknown_at: "2026-10-23T10:00:00+00:00" }));
    expect(await screen.findByText("Capture result unknown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm again" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Confirm TRS-7K2M9Q");
  });

  it("lists the conflicts and jumps to the visits", async () => {
    const user = userEvent.setup();
    open(subscriptionDetail({ conflicts: [occurrence({ id: 9, ulid: "01jx", scheduled_date: "2026-11-08", conflict: { code: "BLACKOUT", details: {}, at: null } })] }));
    expect(await screen.findByText("Visits with a conflict: 1")).toBeInTheDocument();
    expect(screen.getByText(/Blackout day/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open the visits" }));
    await waitFor(() => expect(api.fetchSubscriptionVisits).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Visits" })).toHaveAttribute("aria-selected", "true");
  });

  it("explains a failed renewal: attempt, decline message, the date it is cancelled, and offers Renew now", async () => {
    open(
      subscriptionDetail({
        status: "suspended",
        status_label: { ar: "موقوف", en: "Suspended" },
        payment_health: "suspended",
        actions: { ...subscriptionDetail().actions, renew: true, freeze: false, skip: false },
        renewal: {
          ...subscriptionDetail().renewal,
          state: "suspended",
          attempt_no: 3,
          decline_message: { ar: "رُفضت البطاقة", en: "The card was declined" },
          cancels_on: "2026-12-07",
          unreserved_from_date: "2026-11-29",
          unreserved_visits_count: 4,
        },
      }),
    );
    expect(await screen.findByText("Suspended for an unpaid renewal")).toBeInTheDocument();
    expect(screen.getByText("Attempt 3 of 3.")).toBeInTheDocument();
    expect(screen.getByText("The card was declined")).toBeInTheDocument();
    expect(screen.getByText(/cancelled on Mon, 7 Dec 2026/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Renew now" }).length).toBeGreaterThan(0);
  });

  it("shows a cancellation review with Resolve for finance and Keep for the coordinator", async () => {
    const review = {
      requested_at: "2026-10-23T10:00:00+00:00",
      reason_code: "customer_request",
      reason_text: "Moving abroad",
      party: "customer",
      decision: null,
    };
    const detail = subscriptionDetail({ cancel_review: review as never, actions: { ...subscriptionDetail().actions, resolve_review: true, cancel: false, freeze: false, skip: false } });
    const { unmount } = open(detail, ["subscriptions.manage", "refunds.create"]);
    expect(await screen.findByText("A cancellation waits for review")).toBeInTheDocument();
    expect(screen.getByText(/Reason: Customer request/)).toBeInTheDocument();
    expect(screen.getByText("“Moving abroad”")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resolve with a refund" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Keep the subscription" }).length).toBeGreaterThan(0);
    unmount();

    open(detail, ["subscriptions.view", "refunds.create"]);
    await screen.findByText("A cancellation waits for review");
    expect(screen.getAllByRole("button", { name: "Resolve with a refund" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Keep the subscription" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel as the company" })).not.toBeInTheDocument();
  });

  it("lets a coordinator cancel as the company while a review waits (§4.7), with the party fixed", async () => {
    const user = userEvent.setup();
    const review = { requested_at: "2026-10-23T10:00:00+00:00", reason_code: "customer_request", reason_text: null, party: "customer", decision: null };
    open(subscriptionDetail({ cancel_review: review as never, actions: { ...subscriptionDetail().actions, resolve_review: true, cancel: false, freeze: false, skip: false } }), ["subscriptions.manage"]);
    const banner = (await screen.findByText("A cancellation waits for review")).closest("[role]") as HTMLElement;
    // The customer's own cancellation waits, so the plain Cancel is not offered.
    expect(screen.queryByRole("button", { name: "Cancel subscription" })).not.toBeInTheDocument();
    await user.click(within(banner).getByRole("button", { name: "Cancel as the company" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Cancel TRS-7K2M9Q");
    expect(dialog).toHaveTextContent(/The cancellation waiting for review is closed by this one/);
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    expect(api.previewCancel).toHaveBeenCalledWith(31, "company");
  });

  it("calls a voided card hold released, not a failed payment", async () => {
    const user = userEvent.setup();
    const rejected = subscriptionDetail({
      status: "rejected",
      rejected_reason: "No capacity in the area",
      actions: { ...pendingDetail().actions, confirm: false, reject: false, assign: false },
      periods: [subscriptionPeriod({ status: "void", payment: { id: 55, ulid: "01jpay0000000000000000055", status: "voided", card_label: "Visa •••• 4242" }, invoice: null, refundable_fils: 0 })],
    });
    open(rejected);
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("tab", { name: "Periods and payments" }));
    const rows = within(await screen.findByRole("table", { name: "Periods and payments" })).getAllByRole("row");
    expect(within(rows[1]).getByRole("link", { name: "Card hold released" })).toHaveAttribute("href", "/admin/finance/payments/55");
    expect(within(rows[1]).queryByText("Payment failed")).not.toBeInTheDocument();
  });

  it("lists the customers' requests to move a visit and a running freeze with Unfreeze", async () => {
    open(
      subscriptionDetail({
        status: "paused",
        freeze: { from: "2026-11-15", to: "2026-11-21", running: true },
        actions: { ...subscriptionDetail().actions, freeze: false, unfreeze: true },
        reschedule_requests: [{ id: 5, booking_id: 90, from_date: "2026-11-01", date: "2026-11-02", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" }, requested_at: null }],
      }),
    );
    expect(await screen.findByText("Customer requests to move a visit: 1")).toBeInTheDocument();
    expect(screen.getByText("Frozen from Sun, 15 Nov 2026 to Sat, 21 Nov 2026")).toBeInTheDocument();
    expect(screen.getAllByText(/Frozen until Sat, 21 Nov 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Unfreeze" }).length).toBeGreaterThan(0);
  });

  it("shows how a cancelled subscription ended", async () => {
    open(subscriptionDetail({ status: "cancelled", actions: { ...subscriptionDetail().actions, cancel: false, freeze: false, skip: false }, cancelled: { at: "2026-10-30T09:00:00+00:00", by_type: "staff", by: 2, reason_code: "no_capacity", reason: "No cleaner in the area" } }));
    expect(await screen.findByText(/Cancelled on/)).toBeInTheDocument();
    expect(screen.getByText("“No cleaner in the area”")).toBeInTheDocument();
  });

  it("lists the periods with amounts, the payment and invoice links for finance readers", async () => {
    const user = userEvent.setup();
    open(subscriptionDetail({ periods: [subscriptionPeriod(), subscriptionPeriod({ id: 202, sequence: 2, status: "pending_payment", amount_fils: 99000, notified_amount_fils: 96000, payment: null, invoice: null, refundable_fils: 0 })] }));
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("tab", { name: "Periods and payments" }));
    const rows = within(await screen.findByRole("table", { name: "Periods and payments" })).getAllByRole("row");
    expect(within(rows[1]).getByText("AED 960.00")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("link", { name: "Paid" })).toHaveAttribute("href", "/admin/finance/payments/55");
    expect(within(rows[1]).getByRole("link", { name: "INV-2026-0008" })).toHaveAttribute("href", "/admin/finance/invoices/8");
    expect(within(rows[2]).getByText("Awaiting payment")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Notified: AED 960.00")).toBeInTheDocument();
  });

  it("shows the history, newest first, with what each row says", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("tab", { name: "History" }));
    const row = (await screen.findByText("Confirmed")).closest("li") as HTMLElement;
    expect(within(row).getByText(/Coordinator/)).toBeInTheDocument();
    expect(within(row).getByText("AED 960.00")).toBeInTheDocument();
  });

  it("shows the Live-out calendar tab with the month", async () => {
    const user = userEvent.setup();
    open(liveOutDetail());
    await screen.findByRole("heading", { name: /TRS-L0NG01/ });
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(await screen.findByText(/Absent: Angela · Substitute: Rosa/)).toBeInTheDocument();
    expect(api.fetchSubscriptionCalendar).toHaveBeenCalledWith(32, "2026-11");
  });

  it("shows an error with retry, and a missing subscription", async () => {
    const user = userEvent.setup();
    api.fetchSubscription.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    api.fetchSubscription.mockResolvedValue(subscriptionDetail());
    renderWithProviders(<SubscriptionDetailScreen id="31" />, { permissions: MANAGER });
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: /TRS-7K2M9Q/ })).toBeInTheDocument();
  });

  it("is closed without a subscription permission and reads Arabic", async () => {
    const { unmount } = renderWithProviders(<SubscriptionDetailScreen id="31" />, { permissions: ["bookings.view"] });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchSubscription).not.toHaveBeenCalled();
    unmount();
    open(subscriptionDetail(), MANAGER, "ar");
    expect(await screen.findByRole("heading", { name: /TRS-7K2M9Q/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "الزيارات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تجميد" })).toBeInTheDocument();
  });
});
