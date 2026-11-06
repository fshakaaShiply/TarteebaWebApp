import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { renderWithProviders } from "@/test/render";
import { calendarDay, liveOutDetail, novemberCalendar } from "@/test/subscriptionFixtures";
import { LiveOutCalendar } from "./LiveOutCalendar";

const api = vi.hoisted(() => ({ fetchSubscriptionCalendar: vi.fn() }));
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const sub = liveOutDetail();

function setup(over: { canManage?: boolean; locale?: "en" | "ar" } = {}) {
  const onEditDay = vi.fn();
  const onCancel = vi.fn();
  renderWithProviders(<LiveOutCalendar subscription={sub} canManage={over.canManage ?? true} onEditDay={onEditDay} onCancel={onCancel} />, { permissions: ["subscriptions.manage"], locale: over.locale });
  return { onEditDay, onCancel, user: userEvent.setup() };
}

describe("A08 Live-out calendar", () => {
  beforeEach(() => {
    api.fetchSubscriptionCalendar.mockReset();
    api.fetchSubscriptionCalendar.mockResolvedValue(novemberCalendar());
  });

  it("starts the week on Sunday, in both languages, and opens on the month the contract starts", async () => {
    setup();
    await screen.findByRole("group", { name: "November 2026" });
    const grid = screen.getByRole("group", { name: "November 2026" });
    const headings = within(grid).getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/).map((h) => h.textContent);
    expect(headings).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(api.fetchSubscriptionCalendar).toHaveBeenCalledWith(32, "2026-11");
    // 1 Nov 2026 is a Sunday: no blank cell before it, so the first button is day 1.
    expect(within(grid).getAllByRole("button")[0]).toHaveAccessibleName(/Sunday, 1 November 2026/);
  });

  it("starts on Sunday in Arabic too", async () => {
    setup({ locale: "ar" });
    const grid = await screen.findByRole("group", { name: /نوفمبر 2026/ });
    const first = within(grid).getAllByText(/^(الأحد|الإثنين|الاثنين)$/)[0];
    expect(first.textContent).toBe("الأحد");
  });

  it("sets each worker name in its own bidi run, so a Latin name keeps its period in Arabic", async () => {
    const calendar = novemberCalendar();
    calendar.days = calendar.days.map((d) =>
      d.date === "2026-11-17"
        ? calendarDay(d.date, { type: "absence", worker: { id: 14, name: "Maria S." }, substitute: { id: 15, name: "Siti R." }, flags: ["substitute"] })
        : d.date === "2026-11-18"
          ? calendarDay(d.date, { substitute: { id: 16, name: "Tigist B." } })
          : d,
    );
    api.fetchSubscriptionCalendar.mockResolvedValue(calendar);
    setup({ locale: "ar" });
    const grid = await screen.findByRole("group", { name: /نوفمبر 2026/ });
    const cells = within(grid).getAllByRole("button");
    expect(cells.find((c) => c.textContent?.startsWith("17"))?.textContent).toContain("غياب: \u2068Maria S.\u2069 · البديلة: \u2068Siti R.\u2069");
    expect(cells.find((c) => c.textContent?.startsWith("18"))?.textContent).toContain("البديلة: \u2068Tigist B.\u2069");
    // The header's primary and backup, too; the cell's accessible name reads the plain names.
    expect(screen.getByText("الأساسية: \u2068Angela\u2069 · البديلة: \u2068Rosa\u2069")).toBeInTheDocument();
    expect(cells.find((c) => c.textContent?.startsWith("17"))).toHaveAccessibleName(/Maria S\. · البديلة: Siti R\.$/);
  });

  it("shows service, rest, public holiday and absence cells, the absent worker with her substitute, and the footer counts", async () => {
    setup();
    await screen.findByRole("group", { name: "November 2026" });
    expect(screen.getByRole("button", { name: /Monday, 2 November 2026: Public holiday/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Friday, 6 November 2026: Rest/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wednesday, 11 November 2026: Absent: Angela · Substitute: Rosa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tuesday, 3 November 2026: Service/ })).toBeInTheDocument();
    expect(screen.getByTestId("calendar-footer")).toHaveTextContent("Service days: 24 · Public holidays: 1 · Rest days: 4 · Absences: 1 · Dropped: 0 · Credited: 0.");
    expect(screen.getByTestId("calendar-footer")).toHaveTextContent("Weekly rest: Friday. The primary worker is booked for the whole day.");
  });

  it("shows an absence without a substitute, a dropped day and the credited and conflict marks", async () => {
    const calendar = novemberCalendar();
    calendar.days = calendar.days.map((d) =>
      d.date === "2026-11-11"
        ? calendarDay(d.date, { type: "absence", credited: true, flags: ["credited", "conflict"] })
        : d.date === "2026-11-12"
          ? calendarDay(d.date, { type: "dropped", worker: null })
          : d,
    );
    api.fetchSubscriptionCalendar.mockResolvedValue(calendar);
    setup();
    const absence = await screen.findByRole("button", { name: "Wednesday, 11 November 2026: Absent: Angela · No substitute" });
    expect(within(absence).getByText("Credited")).toBeInTheDocument();
    expect(within(absence).getByText("Conflict")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thursday, 12 November 2026: Dropped/ })).toBeInTheDocument();
  });

  it("edits this day only, or the following days, for a picked day", async () => {
    const { user, onEditDay } = setup();
    await screen.findByRole("group", { name: "November 2026" });
    expect(screen.getByRole("button", { name: "Edit this day only" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Wednesday, 4 November 2026/ }));
    await user.click(screen.getByRole("button", { name: "Edit this day only" }));
    expect(onEditDay).toHaveBeenLastCalledWith(expect.objectContaining({ date: "2026-11-04", type: "service" }), "this");
    await user.click(screen.getByRole("button", { name: "Edit following days" }));
    expect(onEditDay).toHaveBeenLastCalledWith(expect.objectContaining({ date: "2026-11-04" }), "following");
  });

  it("does not offer editing a weekly rest day", async () => {
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: /Friday, 6 November 2026: Rest/ }));
    expect(screen.getByRole("button", { name: "Edit this day only" })).toBeDisabled();
    expect(screen.getByText("This day cannot be changed.")).toBeInTheDocument();
  });

  it("opens the cancellation with its financial preview", async () => {
    const { user, onCancel } = setup();
    await user.click(await screen.findByRole("button", { name: "Cancel with financial preview" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a reader the month without any edit button", async () => {
    setup({ canManage: false });
    await screen.findByRole("group", { name: "November 2026" });
    expect(screen.queryByRole("button", { name: "Edit this day only" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel with financial preview" })).not.toBeInTheDocument();
  });

  it("moves between months and asks for each", async () => {
    const { user } = setup();
    await screen.findByRole("group", { name: "November 2026" });
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(api.fetchSubscriptionCalendar).toHaveBeenLastCalledWith(32, "2026-12"));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(api.fetchSubscriptionCalendar).toHaveBeenLastCalledWith(32, "2026-11"));
  });

  it("shows an error with retry", async () => {
    api.fetchSubscriptionCalendar.mockRejectedValueOnce(new AdminApiError(422, { code: "NOT_LIVE_OUT", message: "", details: {} })).mockResolvedValue(novemberCalendar());
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "November 2026" })).toBeInTheDocument();
  });
});
