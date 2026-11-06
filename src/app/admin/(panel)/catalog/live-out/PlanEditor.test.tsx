import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogService } from "@/lib/admin/types";
import { trialPlan, weeklyPackage } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { PackageEditor } from "../packages/PackageEditor";
import { LiveOutPlansScreen } from "./LiveOutPlansScreen";
import { PlanEditor } from "./PlanEditor";

const api = {
  fetchLiveOutPlans: vi.fn(),
  createLiveOutPlan: vi.fn(),
  updateLiveOutPlan: vi.fn(),
  createPackage: vi.fn(),
  updatePackage: vi.fn(),
  fetchAllServices: vi.fn(),
  fetchAllPolicies: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchLiveOutPlans: (...a: unknown[]) => api.fetchLiveOutPlans(...a),
  createLiveOutPlan: (...a: unknown[]) => api.createLiveOutPlan(...a),
  updateLiveOutPlan: (...a: unknown[]) => api.updateLiveOutPlan(...a),
  createPackage: (...a: unknown[]) => api.createPackage(...a),
  updatePackage: (...a: unknown[]) => api.updatePackage(...a),
  fetchAllServices: (...a: unknown[]) => api.fetchAllServices(...a),
  fetchAllPolicies: (...a: unknown[]) => api.fetchAllPolicies(...a),
}));

const liveOut = { id: 2, code: "LIVE_OUT", kind: "live_out", name: { ar: "يوم كامل", en: "Full day" } } as CatalogService;
const standard = { id: 1, code: "STANDARD_VISIT", kind: "standard_visit", name: { ar: "زيارة تنظيف", en: "Cleaning visit" } } as CatalogService;

describe("A11 Live-out plans and packages", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchAllServices.mockResolvedValue([standard, liveOut]);
    api.fetchAllPolicies.mockResolvedValue([]);
  });

  it("marks a plan without a price as hidden from customers until priced (D-03)", async () => {
    api.fetchLiveOutPlans.mockResolvedValue({ data: [trialPlan], meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 } });
    renderWithProviders(<LiveOutPlansScreen />, { permissions: ["catalog.manage"] });

    expect(await screen.findByText("Hidden from customers until priced (D-03)")).toBeInTheDocument();
    expect(screen.getByText("Plans without a price are hidden from customers until a price is set (D-03).")).toBeInTheDocument();
    expect(await screen.findByText("Full day")).toBeInTheDocument();
  });

  // The seeded plans: the trial day (1 day, no rest) and the monthly plan (26 days, 1 rest day a week).
  const monthlyPlan = { ...trialPlan, id: 2, code: "MONTHLY_26", kind: "monthly" as const, service_days_per_month: 26, rest_days_per_week: 1 };

  it.each([
    ["en", "1 day a month · no rest day a week", "26 days a month · 1 rest day a week"],
    ["ar", "يوم واحد شهريًا · بلا يوم راحة أسبوعيًا", /^(26|٢٦) يومًا شهريًا · يوم راحة واحد أسبوعيًا$/],
  ] as const)("words the service and rest days with plural rules (%s)", async (locale, trial, monthly) => {
    api.fetchLiveOutPlans.mockResolvedValue({ data: [trialPlan, monthlyPlan], meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 } });
    renderWithProviders(<LiveOutPlansScreen />, { permissions: ["catalog.manage"], locale });

    const trialRow = (await screen.findByText("TRIAL_DAY")).closest("tr") as HTMLElement;
    expect(within(trialRow).getByText(trial)).toBeInTheDocument();
    const monthlyRow = screen.getByText("MONTHLY_26").closest("tr") as HTMLElement;
    expect(within(monthlyRow).getByText(monthly)).toBeInTheDocument();
  });

  it("prices the trial day in AED and saves fils with the loaded version", async () => {
    api.updateLiveOutPlan.mockResolvedValue({ ...trialPlan, price_fils: 25000, version: 2 });
    renderWithProviders(<PlanEditor plan={trialPlan} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    expect(screen.getByText("Without a price this plan stays hidden from customers (D-03).")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Price"), "250");
    expect(screen.queryByText("Without a price this plan stays hidden from customers (D-03).")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason for the change/), "Trial price approved");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateLiveOutPlan).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updateLiveOutPlan.mock.calls[0];
    expect([id, version]).toEqual([1, 1]);
    expect(body).not.toHaveProperty("service_id");
    expect(body).not.toHaveProperty("code");
    expect(body).toMatchObject({ kind: "trial_day", price_fils: 25000, window_start: "09:00", window_end: "18:00", reason: "Trial price approved" });
  });

  it("refuses a window shorter than the work hours plus the break", async () => {
    renderWithProviders(<PlanEditor plan={trialPlan} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    const end = screen.getByLabelText(/^Window ends/);
    await user.clear(end);
    await user.type(end, "16:00");
    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("The window is shorter than the work hours plus the break.")).toBeInTheDocument();
    expect(api.updateLiveOutPlan).not.toHaveBeenCalled();
  });

  it("creates a package for a fixed service: visits per week, one term, net fixed discount in fils", async () => {
    api.createPackage.mockResolvedValue({});
    renderWithProviders(<PackageEditor pkg={null} serviceId={1} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    expect(await screen.findByDisplayValue("Cleaning visit (STANDARD_VISIT)")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Code/), "weekly_3");
    await user.type(screen.getByLabelText(/^Name \(Arabic\)/), "ثلاث مرات أسبوعيًا");
    await user.type(screen.getByLabelText(/^Name \(English\)/), "Three times a week");
    expect(screen.getAllByRole("option").filter((o) => o.closest("select")?.getAttribute("name") === "visits_per_week").map((o) => o.getAttribute("value"))).toEqual(["1", "2", "3", "4", "6"]);
    await user.selectOptions(screen.getByLabelText(/^Visits per week/), "3");
    const term = screen.getByLabelText(/^Term\*?$/);
    await user.clear(term);
    await user.type(term, "3");
    await user.selectOptions(screen.getByLabelText(/^Unit/), "months");
    await user.selectOptions(screen.getByLabelText(/^Discount type/), "fixed");
    const discount = screen.getByLabelText(/^Discount amount/);
    await user.clear(discount);
    await user.type(discount, "25");
    await user.type(screen.getByLabelText(/Reason for the change/), "New package");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.createPackage).toHaveBeenCalledTimes(1));
    expect(api.createPackage.mock.calls[0][0]).toMatchObject({
      service_id: 1,
      code: "WEEKLY_3",
      visits_per_week: 3,
      term_weeks: null,
      term_months: 3,
      discount_type: "fixed",
      discount_value: 2500,
      reason: "New package",
    });
  });

  // Phase 4 (design section 9.1, A11).
  const capped = { ...trialPlan, price_fils: 450000, max_active_contracts: 3, active_contracts: 3, unavailable_reason: "cap_reached" as const };

  it("shows the active contracts against the cap and a cap-reached badge in the list", async () => {
    api.fetchLiveOutPlans.mockResolvedValue({
      data: [capped, { ...trialPlan, id: 2, code: "MONTHLY", price_fils: 450000, active_contracts: 1, unavailable_reason: null }],
      meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 },
    });
    renderWithProviders(<LiveOutPlansScreen />, { permissions: ["catalog.manage"] });
    const cappedRow = (await screen.findByText("TRIAL_DAY")).closest("tr") as HTMLElement;
    expect(within(cappedRow).getByText("3 / 3")).toBeInTheDocument();
    expect(within(cappedRow).getByText("Contract cap reached")).toBeInTheDocument();
    const openRow = screen.getByText("MONTHLY").closest("tr") as HTMLElement;
    // No cap: just the count, no badge.
    expect(within(openRow).getByText("1")).toBeInTheDocument();
    expect(within(openRow).queryByText("Contract cap reached")).not.toBeInTheDocument();
  });

  it("flags a plan whose window differs from the Live-out slot", async () => {
    api.fetchLiveOutPlans.mockResolvedValue({
      data: [{ ...trialPlan, window_end: "17:00", window_matches_slot: false }],
      meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
    });
    renderWithProviders(<LiveOutPlansScreen />, { permissions: ["catalog.manage"] });
    expect(await screen.findByText("Window differs from the slot")).toBeInTheDocument();
  });

  it("editor: names the active contracts and the cap, and warns when the window leaves the slot's", async () => {
    renderWithProviders(<PlanEditor plan={capped} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    expect(screen.getByTestId("active-contracts")).toHaveTextContent("Active contracts 3 / 3");
    expect(screen.getByText("Contract cap reached")).toBeInTheDocument();
    // The window equals the slot's: no warning.
    expect(screen.queryByText(/differs from the Live-out slot/)).not.toBeInTheDocument();
    const end = screen.getByLabelText(/Window ends/);
    // A time input is set as a whole.
    fireEvent.change(end, { target: { value: "17:00" } });
    expect(
      await screen.findByText(/differs from the Live-out slot [(]LIVE_OUT_DAY[)], which runs 09:00 to 18:00/),
    ).toBeInTheDocument();
  });

  it.each([
    ["en", "Active contracts"],
    ["ar", "العقود النشطة"],
  ] as const)("editor: isolates only the figures of the contract line, never its label (%s)", (locale, label) => {
    renderWithProviders(<PlanEditor plan={capped} onClose={vi.fn()} />, { permissions: ["catalog.manage"], locale });
    const line = screen.getByTestId("active-contracts");
    // The label keeps the page's direction (an Arabic reader meets it first, at the start of the line) …
    expect(line.textContent?.startsWith(label)).toBe(true);
    // … and only "3 / 3" reads left to right.
    const figures = line.querySelectorAll('bdi[dir="ltr"]');
    expect(figures).toHaveLength(1);
    expect(figures[0].textContent).toMatch(/^(3|٣) \/ (3|٣)$/);
  });

  it("editor: a new plan has no slot to compare with and no contract line", () => {
    renderWithProviders(<PlanEditor plan={null} serviceId={2} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    expect(screen.queryByTestId("active-contracts")).not.toBeInTheDocument();
    expect(screen.queryByText(/differs from the Live-out slot/)).not.toBeInTheDocument();
  });

  it("package editor: warns that a package whose first period is too long is not sold as a subscription", () => {
    const tooLong = {
      ...weeklyPackage,
      subscription_sellable: { ok: false, reason: "term_too_long" as const, visits_per_period: 52, span_days: 364 },
    };
    renderWithProviders(<PackageEditor pkg={tooLong} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    expect(screen.getByText(/can't buy this package as a subscription: its first period needs 52 visits over 364 days/)).toBeInTheDocument();
  });

  it("package editor: no warning for a package that can be sold, or when creating one", () => {
    const { unmount } = renderWithProviders(<PackageEditor pkg={weeklyPackage} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    expect(screen.queryByText(/as a subscription/)).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<PackageEditor pkg={null} serviceId={1} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    expect(screen.queryByText(/as a subscription/)).not.toBeInTheDocument();
  });
});
