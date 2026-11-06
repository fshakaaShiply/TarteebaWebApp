import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { serviceOptions, slotTemplateOptions, zoneOptions } from "@/test/bookingFixtures";
import { renderWithProviders } from "@/test/render";
import { cancelPlan, event, liveOutDetail, novemberCalendar, occurrence, subscriptionDetail } from "@/test/subscriptionFixtures";
import { SubscriptionDetailScreen } from "./SubscriptionDetailScreen";

// The whole page with its dialogs: a button opens its dialog on the subscription as it is, a write refreshes the page,
// and a version that moved meanwhile asks for a reload.
const api = vi.hoisted(() => {
  const names = [
    "fetchSubscription",
    "fetchSubscriptionVisits",
    "fetchSubscriptionCalendar",
    "fetchSubscriptionEvents",
    "fetchWorkerCandidates",
    "previewFreeze",
    "freezeSubscription",
    "previewVisitMove",
    "writeVisit",
    "previewSkip",
    "skipVisit",
    "previewCancel",
    "cancelSubscription",
    "previewLiveOutDay",
    "changeLiveOutDay",
    "previewFollowing",
  ];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZoneOptions: async () => zoneOptions,
  fetchServiceOptions: async () => serviceOptions,
  fetchSlotTemplateOptions: async () => slotTemplateOptions,
}));

const MANAGER = ["subscriptions.manage", "bookings.view"];
const meta = { current_page: 1, per_page: 100, total: 1, last_page: 1 };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchSubscriptionVisits.mockResolvedValue({ data: [occurrence({ scheduled_date: "2026-11-04", occurrence_date: "2026-11-04" })], meta });
  api.fetchSubscriptionEvents.mockResolvedValue({ data: [event()], meta });
  api.fetchSubscriptionCalendar.mockResolvedValue(novemberCalendar());
  api.fetchWorkerCandidates.mockResolvedValue([]);
  api.previewFreeze.mockReturnValue(new Promise(() => undefined));
  api.previewVisitMove.mockReturnValue(new Promise(() => undefined));
  api.previewSkip.mockReturnValue(new Promise(() => undefined));
  api.previewFollowing.mockReturnValue(new Promise(() => undefined));
  api.previewLiveOutDay.mockReturnValue(new Promise(() => undefined));
  api.previewCancel.mockResolvedValue(cancelPlan());
});

function open(detail = subscriptionDetail()) {
  api.fetchSubscription.mockResolvedValue(detail);
  renderWithProviders(<SubscriptionDetailScreen id={String(detail.id)} />, { permissions: MANAGER });
  return userEvent.setup();
}

describe("A08 actions open their dialogs", () => {
  it("opens Freeze, Skip a visit and Cancel from the header", async () => {
    const user = open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Freeze TRS-7K2M9Q");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Skip a visit" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Skip a visit of TRS-7K2M9Q");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel subscription" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Cancel TRS-7K2M9Q");
    expect(await screen.findByRole("table", { name: "Periods of the cancellation" })).toBeInTheDocument();
  });

  it("opens the worker dialogs from the workers card", async () => {
    const user = open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("button", { name: "Backup worker" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Backup worker of TRS-7K2M9Q");
  });

  it("opens Edit this visit and Edit following visits from a Visits row", async () => {
    const user = open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("tab", { name: "Visits" }));
    const row = (await screen.findByText("Wed, 4 Nov 2026")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit this visit" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Edit the visit of Wed, 4 Nov 2026");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(within(row).getByRole("button", { name: "Edit following visits" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Edit the visits following Wed, 4 Nov 2026");
  });

  it("opens the Live-out day dialog from the calendar and the cancellation from its footer button", async () => {
    const user = open(liveOutDetail());
    await screen.findByRole("heading", { name: /TRS-L0NG01/ });
    await user.click(screen.getByRole("tab", { name: "Calendar" }));
    await user.click(await screen.findByRole("button", { name: /Wednesday, 4 November 2026/ }));
    await user.click(screen.getByRole("button", { name: "Edit following days" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Edit Wed, 4 Nov 2026 and the following days");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Cancel with financial preview" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Cancel TRS-L0NG01");
  });
});

describe("A08 a write refreshes the page and a stale version asks for a reload", () => {
  it("shows the subscription the write answered with, and refreshes the lists", async () => {
    const frozen = subscriptionDetail({ version: 8, status: "paused", freeze: { from: "2026-11-15", to: "2026-11-21", running: true }, actions: { ...subscriptionDetail().actions, freeze: false, unfreeze: true } });
    api.previewFreeze.mockResolvedValue({ allowed: true, reason: null, from: "2026-11-15", to: "2026-11-21", days: 7, affected: [], appended_dates: [], new_term_end_date: "2026-12-05", fee_fils: 0, refund_fils: 0, freeze_days_used_this_period: 7, max_freeze_days: 14, explanation: { ar: "", en: "" } });
    api.freezeSubscription.mockResolvedValue(frozen);
    const user = open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    const from = await screen.findByLabelText("From", { exact: false });
    await user.clear(from);
    await user.type(from, "2026-11-15");
    await user.type(screen.getByLabelText("To", { exact: false }), "2026-11-21");
    await screen.findByText("Sat, 5 Dec 2026", { selector: "dd" });
    api.fetchSubscription.mockResolvedValue(frozen);
    await user.click(screen.getByRole("button", { name: "Freeze" }));
    expect((await screen.findAllByRole("button", { name: "Unfreeze" })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Frozen until Sat, 21 Nov 2026/).length).toBeGreaterThan(0);
    expect(api.freezeSubscription.mock.calls[0][2]).toBe(7);
  });

  it("closes the dialog on 409 STALE_VERSION and asks to reload", async () => {
    api.previewSkip.mockResolvedValue({ allowed: true, reason: null, visit: { ulid: "01jocc0000000000000000501", date: "2026-11-01", slot: null }, appended_date: "2026-11-29", new_term_end_date: "2026-11-29", fee_fils: 0, refund_fils: 0, discount_effect: "kept", explanation: { ar: "", en: "" } });
    api.skipVisit.mockRejectedValue(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: { current_version: 9 } }));
    const user = open();
    await screen.findByRole("heading", { name: /TRS-7K2M9Q/ });
    await user.click(screen.getByRole("button", { name: "Skip a visit" }));
    await screen.findAllByText("Sun, 29 Nov 2026", { selector: "dd" });
    await user.click(screen.getByRole("button", { name: "Skip the visit" }));
    expect(await screen.findByText("This record was changed")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
