import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { occurrence, subscriptionDetail } from "@/test/subscriptionFixtures";
import { VisitsTab, groupByPeriod } from "./VisitsTab";

const api = vi.hoisted(() => ({ fetchSubscriptionVisits: vi.fn() }));
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const MANAGER = ["subscriptions.manage", "bookings.view"];
const meta = { current_page: 1, per_page: 100, total: 5, last_page: 1 };
const rows = () => [
  occurrence(),
  occurrence({ id: 502, ulid: "01jocc2", scheduled_date: "2026-11-04", occurrence_date: "2026-11-04" }),
  occurrence({
    id: 503,
    ulid: "01jocc3",
    scheduled_date: "2026-11-08",
    occurrence_date: "2026-11-08",
    state: "held",
    state_label: "Capacity held",
    booking: null,
    visit: null,
    workers: [],
    conflict: { code: "BLACKOUT", details: {}, at: null },
    editable: { this: true, following: true, skip: true, undo_skip: false },
  }),
  occurrence({
    id: 504,
    ulid: "01jocc4",
    scheduled_date: "2026-11-11",
    occurrence_date: "2026-11-11",
    state: "planned",
    state_label: "Planned",
    booking: null,
    visit: null,
    workers: [],
    conflict: { code: "SLOT_FULL", details: { reason: "max_bookings" }, at: null },
  }),
  occurrence({
    id: 505,
    ulid: "01jocc5",
    scheduled_date: "2026-11-30",
    occurrence_date: "2026-11-29",
    period_sequence: 2,
    visit: { id: 71, status: "worker_assigned", is_exception: true, original_date: "2026-11-29" },
    reschedule_request: { id: 5, date: "2026-12-02", slot: { id: 2, code: "EVENING", start: "15:00", end: "19:00" } },
  }),
  occurrence({ id: 506, ulid: "01jocc6", scheduled_date: "2026-11-15", state: "replaced", state_label: "Replaced" }),
  occurrence({ id: 507, ulid: "01jocc7", scheduled_date: "2026-11-18", state: "skipped", state_label: "Skipped", booking: null, visit: null, editable: { this: false, following: false, skip: false, undo_skip: true } }),
];

function setup(permissions = MANAGER, detail = subscriptionDetail()) {
  const open = vi.fn();
  renderWithProviders(<VisitsTab subscription={detail} open={open} />, { permissions });
  return { open, user: userEvent.setup() };
}

describe("A08 visits tab", () => {
  beforeEach(() => {
    api.fetchSubscriptionVisits.mockReset();
    api.fetchSubscriptionVisits.mockResolvedValue({ data: rows(), meta });
  });

  it("asks for the next 31 days and groups the visits by period, leaving replaced dates out", async () => {
    setup();
    await screen.findByRole("heading", { name: "Period 1" });
    expect(api.fetchSubscriptionVisits).toHaveBeenCalledWith(31, expect.objectContaining({ perPage: 100, from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    expect(screen.getByRole("heading", { name: "Period 2" })).toBeInTheDocument();
    expect(screen.queryByText("Replaced")).not.toBeInTheDocument();
    const first = screen.getByRole("table", { name: "Period 1" });
    expect(within(first).getAllByRole("row")).toHaveLength(1 + 5);
  });

  it("waits for a worker only on visits that will take place; a skipped, credited or cancelled one shows a dash", async () => {
    const gone = { booking: null, visit: null, workers: [], editable: { this: false, following: false, skip: false, undo_skip: false } };
    api.fetchSubscriptionVisits.mockResolvedValue({
      data: [
        occurrence({ id: 601, ulid: "01jocc61", scheduled_date: "2026-11-11", occurrence_date: "2026-11-11", state: "planned", state_label: "Planned", ...gone }),
        occurrence({ id: 602, ulid: "01jocc62", scheduled_date: "2026-11-15", occurrence_date: "2026-11-15", state: "skipped", state_label: "Skipped", ...gone }),
        occurrence({ id: 603, ulid: "01jocc63", scheduled_date: "2026-11-18", occurrence_date: "2026-11-18", state: "credited", state_label: "Credited", ...gone }),
        occurrence({ id: 604, ulid: "01jocc64", scheduled_date: "2026-11-22", occurrence_date: "2026-11-22", state: "cancelled", state_label: "Cancelled", ...gone }),
        occurrence({ id: 605, ulid: "01jocc65", scheduled_date: "2026-11-25", occurrence_date: "2026-11-25", workers: [{ id: 14, name: "Maria S." }] }),
      ],
      meta,
    });
    setup();
    const workersOf = async (date: string) => {
      const row = (await screen.findByText(date)).closest("tr") as HTMLElement;
      return within(row).getAllByRole("cell")[3];
    };
    expect(await workersOf("Wed, 11 Nov 2026")).toHaveTextContent("Not named yet");
    for (const date of ["Sun, 15 Nov 2026", "Wed, 18 Nov 2026", "Sun, 22 Nov 2026"]) {
      const cell = await workersOf(date);
      expect(cell, date).toHaveTextContent("—");
      expect(cell, date).not.toHaveTextContent("Not named yet");
    }
    // A named worker is her own bidi run (<bdi>), so "Maria S." keeps its period in Arabic.
    expect((await workersOf("Wed, 25 Nov 2026")).querySelector("bdi:not([dir])")).toHaveTextContent("Maria S.");
  });

  it("gives each row two separate buttons, Edit this visit and Edit following visits", async () => {
    const { open, user } = setup();
    const row = (await screen.findByText("Wed, 4 Nov 2026")).closest("tr") as HTMLElement;
    const buttons = within(row).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toContain("Edit this visit");
    expect(buttons).toContain("Edit following visits");
    await user.click(within(row).getByRole("button", { name: "Edit this visit" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "move", visit: expect.objectContaining({ ulid: "01jocc2" }) });
    await user.click(within(row).getByRole("button", { name: "Edit following visits" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "following", visit: expect.objectContaining({ ulid: "01jocc2" }) });
    await user.click(within(row).getByRole("button", { name: "Skip" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "skip", visit: expect.objectContaining({ ulid: "01jocc2" }) });
    await user.click(within(row).getByRole("button", { name: "Company missed it" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "companyMiss", visit: expect.objectContaining({ ulid: "01jocc2" }) });
  });

  it("highlights blackout and conflict rows and names the conflict with its Scheduling reason (P4-245)", async () => {
    setup();
    const blackout = (await screen.findByText("Sun, 8 Nov 2026")).closest("tr") as HTMLElement;
    expect(blackout).toHaveAttribute("data-conflict", "blackout");
    expect(within(blackout).getByText("Blackout day")).toBeInTheDocument();
    const full = screen.getByText("Wed, 11 Nov 2026").closest("tr") as HTMLElement;
    expect(full).toHaveAttribute("data-conflict", "conflict");
    expect(within(full).getByText("Conflict · Slot is full · booking limit reached")).toBeInTheDocument();
    expect(full).not.toHaveTextContent("max_bookings");
    expect(screen.getByText("Wed, 4 Nov 2026").closest("tr")).not.toHaveAttribute("data-conflict");
  });

  it("marks a moved visit and the pending reschedule request, with the decision button", async () => {
    const { open, user } = setup();
    const row = (await screen.findByText("Mon, 30 Nov 2026")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Moved from Sun, 29 Nov 2026")).toBeInTheDocument();
    expect(within(row).getByText("Customer asks for Wed, 2 Dec 2026, 15:00–19:00")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Decide the request" }));
    expect(open).toHaveBeenLastCalledWith({
      kind: "decide",
      request: { visit: "01jocc5", current: { date: "2026-11-30", slot: expect.objectContaining({ id: 1 }) }, requested: { date: "2026-12-02", slot: expect.objectContaining({ id: 2 }) } },
    });
  });

  it("offers Undo skip on a skipped visit and nothing else", async () => {
    const { open, user } = setup();
    const row = (await screen.findByText("Wed, 18 Nov 2026")).closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Undo skip"]);
    await user.click(within(row).getByRole("button", { name: "Undo skip" }));
    expect(open).toHaveBeenLastCalledWith({ kind: "undoSkip", visit: expect.objectContaining({ ulid: "01jocc7" }) });
  });

  it("shows a reader the visits without any button, and links the booking only with bookings.view", async () => {
    setup(["subscriptions.view"]);
    const row = (await screen.findByText("Wed, 4 Nov 2026")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
    expect(within(row).getByText("TRB-V3V3V3")).toBeInTheDocument();
  });

  it("links the booking for staff who can read bookings", async () => {
    setup();
    const row = (await screen.findByText("Wed, 4 Nov 2026")).closest("tr") as HTMLElement;
    expect(within(row).getByRole("link", { name: "TRB-V3V3V3" })).toHaveAttribute("href", "/admin/bookings/90");
  });

  it("moves the window by 31 days", async () => {
    const { user } = setup();
    await screen.findByRole("heading", { name: "Period 1" });
    const first = api.fetchSubscriptionVisits.mock.calls[0][1].from as string;
    await user.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(api.fetchSubscriptionVisits.mock.calls.at(-1)?.[1].from).not.toBe(first));
  });

  it("says there are no visits in the range", async () => {
    api.fetchSubscriptionVisits.mockResolvedValue({ data: [], meta: { ...meta, total: 0 } });
    setup();
    expect(await screen.findByText("No visits in this range")).toBeInTheDocument();
  });

  it("groups rows by period sequence in date order", () => {
    const groups = groupByPeriod([occurrence({ id: 2, scheduled_date: "2026-11-04" }), occurrence({ id: 1, scheduled_date: "2026-11-01" }), occurrence({ id: 3, period_sequence: null, scheduled_date: "2026-12-30" })]);
    expect(groups.map((g) => [g.sequence, g.rows.map((r) => r.id)])).toEqual([
      [1, [1, 2]],
      [null, [3]],
    ]);
  });
});
