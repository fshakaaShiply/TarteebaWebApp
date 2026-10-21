import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogService } from "@/lib/admin/types";
import { trialPlan } from "@/test/catalogFixtures";
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
});
