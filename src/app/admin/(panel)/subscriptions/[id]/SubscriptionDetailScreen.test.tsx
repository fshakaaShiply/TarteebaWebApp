import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { serviceOptions, slotTemplateOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { event, liveOutDetail, novemberCalendar, occurrence, pendingDetail, subscriptionDetail, subscriptionPeriod } from "@/test/subscriptionFixtures";
import { SubscriptionDetailScreen } from "./SubscriptionDetailScreen";

const api = vi.hoisted(() => {
  const names = [
    "fetchSubscription",
    "fetchSubscriptionVisits",
    "fetchSubscriptionCalendar",
    "fetchSubscriptionEvents",
    "fetchWorkerCandidates",
    "previewFreeze",
    "previewConfirm",
    "previewCancel",
    "previewVisitMove",
    "decideRescheduleRequest",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotTemplateOptions,
}));

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
    api.previewVisitMove.mockResolvedValue({ allowed: true, blockers: [], requires_approval: false, availability: { status: "available", reason: null }, explanation: "" });
  });

  it("words the contract's source, materials and add-ons in the admin's language", async () => {
    const addons = {
      addons: ["IRONING", "FRIDGE", "OLD_CODE"],
      addon_details: [
        { code: "IRONING", name: { ar: "الكيّ", en: "Ironing" } },
        { code: "FRIDGE", name: { ar: "تنظيف الثلاجة", en: "Fridge cleaning" } },
        { code: "OLD_CODE", name: null },
      ],
    };
    const detail = subscriptionDetail({ source: "app", materials_by: "company", ...addons });
    const { unmount } = open(detail, MANAGER, "ar");
    const card = (await screen.findByText("العقد")).closest("section") ?? document.body;
    expect(within(card as HTMLElement).getByText("التطبيق")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("الشركة تُحضر مواد التنظيف")).toBeInTheDocument();
    // The detail's own names (P4-244), joined with the Arabic comma; a code the catalogue no longer names stays as it is.
    expect(within(card as HTMLElement).getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "الكيّ، تنظيف الثلاجة، OLD_CODE")).toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText("app")).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByText("company")).not.toBeInTheDocument();
    unmount();

    // A reader with subscriptions.view only (no add-on pick list) sees the names too.
    open(subscriptionDetail(addons), READER);
    expect(await screen.findByText("Customer's own materials")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Ironing, Fridge cleaning, OLD_CODE")).toBeInTheDocument();
    expect(screen.queryByText("IRONING")).not.toBeInTheDocument();
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
    // The first visit is the API's first_visit_at (P4-244), not one of the next visits the detail lists.
    open(pendingDetail({ first_visit_at: "2026-12-06T11:00:00+00:00", upcoming: [] }));
    expect(await screen.findByText("Waiting for confirmation")).toBeInTheDocument();
    expect(screen.getByText(/Decide by/)).toBeInTheDocument();
    expect(screen.getByText("First visit: 6 Dec 2026, 15:00.")).toBeInTheDocument();
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

  // The banner's conflicts as the API writes them: a blackout always carries `reason: "blackout"` (FlagBlackoutConflicts).
  const bannerConflicts = () => [
    occurrence({ id: 9, ulid: "01jx", scheduled_date: "2026-11-08", conflict: { code: "BLACKOUT", details: { date: "2026-11-08", slot_template_id: 1, reason: "blackout", blackout_id: 3 }, at: null } }),
    occurrence({ id: 10, ulid: "01jy", scheduled_date: "2026-11-11", conflict: { code: "SLOT_FULL", details: { reason: "seats" }, at: null } }),
  ];
  /** The parts after the date of the banner line that names `label` ("Sun, 8 Nov 2026 · Blackout day" → ["Blackout day"]). */
  const bannerLine = (label: string) => {
    const lines = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "")
      .filter((line) => line.includes(label));
    expect(lines).toHaveLength(1);
    return lines[0].split(" · ").slice(1);
  };

  it("lists the conflicts and jumps to the visits", async () => {
    const user = userEvent.setup();
    open(subscriptionDetail({ conflicts: bannerConflicts() }));
    expect(await screen.findByText("Visits with a conflict: 2")).toBeInTheDocument();
    // A blackout is named once: its reason ("blackout") says nothing the code does not.
    expect(bannerLine("Blackout day")).toEqual(["Blackout day"]);
    // The conflict code and the Scheduling reason it carries (P4-245), in words.
    expect(bannerLine("Slot is full")).toEqual(["Slot is full", "not enough seats in the vans"]);
    await user.click(screen.getByRole("button", { name: "Open the visits" }));
    await waitFor(() => expect(api.fetchSubscriptionVisits).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "Visits" })).toHaveAttribute("aria-selected", "true");
  });

  it("names a blackout conflict once in Arabic too", async () => {
    open(subscriptionDetail({ conflicts: bannerConflicts() }), MANAGER, "ar");
    expect(await screen.findByText("زيارات فيها تعارض: 2")).toBeInTheDocument();
    expect(bannerLine("يوم مغلق")).toEqual(["يوم مغلق"]);
    expect(bannerLine("الفترة ممتلئة")).toEqual(["الفترة ممتلئة", "لا تكفي مقاعد النقل"]);
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

  it("waits with Renew now while a renewal attempt is under way (P4-251), and says why", async () => {
    const failing = {
      status: "renewal_failed",
      payment_health: "renewal_failed",
      actions: { ...subscriptionDetail().actions, renew: true, freeze: false, skip: false },
    };
    const { unmount } = open(subscriptionDetail({ ...failing, renewal: { ...subscriptionDetail().renewal, state: "failed", attempt_no: 2, attempt_under_way: true } }));
    expect(await screen.findByText("The last renewal payment failed")).toBeInTheDocument();
    expect(screen.getByText(/A renewal payment is being processed/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Renew now" });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeDisabled();
    unmount();

    // Once the attempt has its answer, Renew now is offered again.
    open(subscriptionDetail({ ...failing, renewal: { ...subscriptionDetail().renewal, state: "failed", attempt_no: 2, attempt_under_way: false } }));
    await screen.findByText("The last renewal payment failed");
    expect(screen.queryByText(/A renewal payment is being processed/)).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Renew now" })) expect(button).toBeEnabled();
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
        reschedule_requests: [
          { id: 5, booking_id: 90, occurrence_ulid: "01jocc0000000000000000501", occurrence_date: "2026-11-01", from_date: "2026-11-01", date: "2026-11-02", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" }, requested_at: null },
        ],
      }),
    );
    expect(await screen.findByText("Customer requests to move a visit: 1")).toBeInTheDocument();
    expect(screen.getByText("Frozen from Sun, 15 Nov 2026 to Sat, 21 Nov 2026")).toBeInTheDocument();
    expect(screen.getAllByText(/Frozen until Sat, 21 Nov 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Unfreeze" }).length).toBeGreaterThan(0);
  });

  it("decides a customer's request on its occurrence, also for a visit past the next 14 (P4-244)", async () => {
    const user = userEvent.setup();
    api.decideRescheduleRequest.mockResolvedValue(subscriptionDetail());
    const far = { id: 6, booking_id: 140, occurrence_ulid: "01joccFAR", occurrence_date: "2027-01-10", from_date: "2027-01-10", date: "2027-01-12", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" }, requested_at: null };
    const lost = { ...far, id: 7, booking_id: 141, occurrence_ulid: null, occurrence_date: null };
    open(subscriptionDetail({ reschedule_requests: [far, lost] }));
    const banner = (await screen.findByText("Customer requests to move a visit: 2")).closest("[role]") as HTMLElement;
    // Only a request with an occurrence can be decided; nothing sends staff to look for it in the Visits tab.
    const decide = within(banner).getAllByRole("button", { name: "Decide" });
    expect(decide).toHaveLength(1);
    expect(within(banner).queryByRole("button", { name: "Open the visits" })).not.toBeInTheDocument();
    await user.click(decide[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Sun, 10 Jan 2027");
    expect(dialog).toHaveTextContent("Tue, 12 Jan 2027 · 15:00–19:00");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.decideRescheduleRequest).toHaveBeenCalled());
    expect(api.decideRescheduleRequest.mock.calls[0].slice(0, 4)).toEqual([31, "01joccFAR", { decision: "approve" }, 7]);
  });

  it("opens the move dialog of a visit the A04 board handed over, filled with where it was dropped", async () => {
    const dropped = occurrence({ id: 507, ulid: "01jocc0000000000000000507", scheduled_date: "2026-11-11", occurrence_date: "2026-11-11", booking: { id: 95, reference: "TRB-DROP01", status: "confirmed" } });
    api.fetchSubscriptionVisits.mockImplementation(async (_id: number, q: { from?: string; to?: string }) =>
      q.from === "2026-11-11" && q.to === "2026-11-11" ? { data: [occurrence({ id: 506, booking: { id: 94, reference: "TRB-OTHER1", status: "confirmed" } }), dropped], meta } : { data: [occurrence()], meta },
    );
    api.fetchSubscription.mockResolvedValue(subscriptionDetail());
    renderWithProviders(<SubscriptionDetailScreen id="31" handoff={{ booking: 95, on: "2026-11-11", date: "2026-11-12", slotId: 2 }} />, { permissions: MANAGER });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Edit the visit of Wed, 11 Nov 2026");
    expect(within(dialog).getByLabelText("New date", { exact: false })).toHaveValue("2026-11-12");
    await waitFor(() => expect(within(dialog).getByLabelText("New time", { exact: false })).toHaveValue("2"));
    await waitFor(() => expect(api.previewVisitMove).toHaveBeenCalledWith(31, "01jocc0000000000000000507", { scope: "this", date: "2026-11-12", slot_template_id: 2 }));
    // Behind the dialog, the page is on its Visits tab.
    expect(screen.getByRole("tab", { name: "Visits", hidden: true })).toHaveAttribute("aria-selected", "true");
  });

  it("says so when the handed-over visit is not there or cannot be moved, and opens no dialog", async () => {
    api.fetchSubscriptionVisits.mockResolvedValue({ data: [occurrence()], meta });
    api.fetchSubscription.mockResolvedValue(subscriptionDetail());
    const { unmount } = renderWithProviders(<SubscriptionDetailScreen id="31" handoff={{ booking: 95, on: "2026-11-11", date: "2026-11-12", slotId: 2 }} />, { permissions: MANAGER });
    expect(await screen.findByText(/is not among this subscription's visits of Wed, 11 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    unmount();

    // A reader may not move it: the visit is there, but no dialog opens.
    api.fetchSubscriptionVisits.mockResolvedValue({ data: [occurrence({ booking: { id: 95, reference: "TRB-DROP01", status: "confirmed" } })], meta });
    renderWithProviders(<SubscriptionDetailScreen id="31" handoff={{ booking: 95, on: "2026-11-01", date: "2026-11-02", slotId: null }} />, { permissions: READER });
    expect(await screen.findByText(/can't be moved now/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
