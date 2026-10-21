import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Addon } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { AddonsScreen } from "./AddonsScreen";

const api = { fetchAddons: vi.fn(), createAddon: vi.fn(), updateAddon: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchAddons: (...a: unknown[]) => api.fetchAddons(...a),
  createAddon: (...a: unknown[]) => api.createAddon(...a),
  updateAddon: (...a: unknown[]) => api.updateAddon(...a),
}));

// CatalogSeeder: the company materials add-on, inactive and unpriced until D-02b is decided.
const materials: Addon = {
  id: 1,
  code: "MATERIALS",
  name: { ar: "مواد التنظيف من الشركة", en: "Cleaning materials from the company" },
  amount_fils: 0,
  vat_inclusive: true,
  per: "visit",
  is_active: false,
  sort_order: 1,
  version: 1,
  created_at: null,
  updated_at: null,
};

describe("A11 add-ons", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchAddons.mockResolvedValue({ data: [materials], meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 } });
  });

  it("edits the materials fee in AED and saves fils with the loaded version", async () => {
    api.updateAddon.mockResolvedValue({ ...materials, amount_fils: 1500, is_active: true, version: 2 });
    renderWithProviders(<AddonsScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Edit Cleaning materials from the company" }));
    const drawer = await screen.findByRole("dialog", { name: /Cleaning materials from the company/ });
    const amount = within(drawer).getByLabelText(/^Amount\*?$/);
    expect(amount).toHaveValue("0.00");
    await user.clear(amount);
    await user.type(amount, "15");
    await user.click(within(drawer).getByRole("switch", { name: "Active" }));
    await user.type(within(drawer).getByLabelText(/Reason for the change/), "Materials fee approved");
    await user.click(within(drawer).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateAddon).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updateAddon.mock.calls[0];
    expect([id, version]).toEqual([1, 1]);
    expect(body).toEqual({
      name: materials.name,
      amount_fils: 1500,
      vat_inclusive: true,
      per: "visit",
      is_active: true,
      sort_order: 1,
      reason: "Materials fee approved",
    });
  });

  it("renders in Arabic with the dirham sign", async () => {
    renderWithProviders(<AddonsScreen />, { permissions: ["catalog.manage"], locale: "ar" });
    expect(await screen.findByText("مواد التنظيف من الشركة")).toBeInTheDocument();
    expect(screen.getByText("0 د.إ")).toBeInTheDocument();
  });
});
