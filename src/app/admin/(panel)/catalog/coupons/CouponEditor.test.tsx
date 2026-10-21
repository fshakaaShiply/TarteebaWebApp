import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Coupon } from "@/lib/admin/types";
import { standardService, weeklyPackage } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { CouponEditor, CouponsScreen } from "./CouponsScreen";

const api = {
  fetchCoupons: vi.fn(),
  createCoupon: vi.fn(),
  updateCoupon: vi.fn(),
  fetchAllServices: vi.fn(),
  fetchAllPackages: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchCoupons: (...a: unknown[]) => api.fetchCoupons(...a),
  createCoupon: (...a: unknown[]) => api.createCoupon(...a),
  updateCoupon: (...a: unknown[]) => api.updateCoupon(...a),
  fetchAllServices: (...a: unknown[]) => api.fetchAllServices(...a),
  fetchAllPackages: (...a: unknown[]) => api.fetchAllPackages(...a),
}));

const summer: Coupon = {
  id: 4,
  code: "SUMMER-50",
  type: "fixed",
  value: 5000,
  max_discount_fils: null,
  min_order_fils: 20000,
  valid_from: "2026-11-01",
  valid_to: "2026-11-30",
  usage_limit_total: 100,
  usage_limit_per_customer: 1,
  applies_to: { service_ids: [1] },
  is_active: true,
  version: 3,
  created_at: null,
  updated_at: null,
};

describe("A11 coupons", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchAllServices.mockResolvedValue([standardService]);
    api.fetchAllPackages.mockResolvedValue([weeklyPackage]);
  });

  it("creates a fixed coupon: upper-case code, net amount in fils, chosen services", async () => {
    api.createCoupon.mockResolvedValue({ ...summer, id: 5 });
    renderWithProviders(<CouponEditor coupon={null} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    const dialog = screen.getByRole("dialog", { name: "New coupon" });

    await user.type(within(dialog).getByLabelText(/^Code/), "summer-50");
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), "fixed");
    expect(within(dialog).getByText("A net amount before VAT (R-07).")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Amount/), "50");
    await user.type(within(dialog).getByLabelText(/^Minimum order/), "200");
    await user.type(within(dialog).getByLabelText(/^Total uses/), "100");
    await user.type(within(dialog).getByLabelText(/^Uses per customer/), "1");
    await user.click(await within(dialog).findByLabelText("Cleaning visit (STANDARD_VISIT)"));
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "November campaign");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.createCoupon).toHaveBeenCalledTimes(1));
    expect(api.createCoupon.mock.calls[0][0]).toEqual({
      code: "SUMMER-50",
      type: "fixed",
      value: 5000,
      max_discount_fils: null,
      min_order_fils: 20000,
      valid_from: null,
      valid_to: null,
      usage_limit_total: 100,
      usage_limit_per_customer: 1,
      applies_to: { service_ids: [1] },
      is_active: false,
      reason: "November campaign",
    });
  });

  it("mirrors the API rules: code length and percent 1..100", async () => {
    renderWithProviders(<CouponEditor coupon={null} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    const dialog = screen.getByRole("dialog", { name: "New coupon" });

    await user.type(within(dialog).getByLabelText(/^Code/), "ab");
    await user.type(within(dialog).getByLabelText(/^Percentage/), "101");
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "x");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(await within(dialog).findByText("Use 3 to 40 characters: capital letters, digits, _ and -.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter a whole percentage from 1 to 100.")).toBeInTheDocument();
    expect(api.createCoupon).not.toHaveBeenCalled();
  });

  it("edits with the loaded version and never resends the code", async () => {
    api.updateCoupon.mockResolvedValue({ ...summer, version: 4, is_active: false });
    renderWithProviders(<CouponEditor coupon={summer} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    expect(screen.getByLabelText(/^Code/)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^Amount/)).toHaveValue("50.00");
    await user.click(screen.getByRole("switch", { name: "Active" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "Paused");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateCoupon).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updateCoupon.mock.calls[0];
    expect([id, version]).toEqual([4, 3]);
    expect(body).not.toHaveProperty("code");
    expect(body).toMatchObject({ value: 5000, is_active: false, applies_to: { service_ids: [1] }, reason: "Paused" });
  });

  it("lists coupons with their net discount and searches by code", async () => {
    api.fetchCoupons.mockResolvedValue({ data: [summer], meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 } });
    renderWithProviders(<CouponsScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    expect(await screen.findByText("SUMMER-50")).toBeInTheDocument();
    expect(screen.getByText("Before VAT")).toBeInTheDocument();
    expect(screen.getByText("1 service")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search"), "sum");
    await waitFor(() => expect(api.fetchCoupons).toHaveBeenLastCalledWith(expect.objectContaining({ search: "sum", page: 1 })));
  });
});
