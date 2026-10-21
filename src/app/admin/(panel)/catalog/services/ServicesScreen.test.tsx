import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogService } from "@/lib/admin/types";
import { servicePreview, standardService } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { ServicesScreen } from "./ServicesScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/catalog/services",
}));

const api = { fetchServices: vi.fn(), fetchPublicServices: vi.fn(), createService: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchServices: (...a: unknown[]) => api.fetchServices(...a),
  fetchPublicServices: (...a: unknown[]) => api.fetchPublicServices(...a),
  createService: (...a: unknown[]) => api.createService(...a),
}));

const deepClean: CatalogService = {
  ...standardService,
  id: 3,
  code: "DEEP_CLEAN",
  kind: "future_specialized",
  name: { ar: "تنظيف عميق", en: "Deep cleaning" },
  is_active: false,
  version: 1,
};

describe("A11 services list", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    push.mockReset();
    api.fetchServices.mockResolvedValue({
      data: [standardService, deepClean],
      meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 },
    });
    api.fetchPublicServices.mockResolvedValue([servicePreview.payload.en]);
  });

  it("shows code, kind, status and the public price from (VAT included)", async () => {
    renderWithProviders(<ServicesScreen />, { permissions: ["catalog.manage"] });

    const row = (await screen.findByText("STANDARD_VISIT")).closest("tr") as HTMLElement;
    // The name and the kind label ("standard_visit") read the same here.
    expect(within(row).getAllByText("Cleaning visit")).toHaveLength(2);
    expect(within(row).getByText("AED 120")).toBeInTheDocument();
    expect(within(row).getByText(/incl. VAT/)).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();

    const draft = screen.getByText("DEEP_CLEAN").closest("tr") as HTMLElement;
    expect(within(draft).getByText("Inactive")).toBeInTheDocument();
    expect(within(draft).getByText("Not shown to customers")).toBeInTheDocument();
  });

  it("lines the code up under the name in Arabic: the line follows the page direction, only the code is LTR", async () => {
    renderWithProviders(<ServicesScreen />, { permissions: ["catalog.manage"], locale: "ar" });

    const code = await screen.findByText("STANDARD_VISIT");
    expect(code.tagName).toBe("BDI");
    expect(code).toHaveAttribute("dir", "ltr");
    // The line itself must not be dir="ltr" (that would start it at the left edge, away from the name).
    const line = code.parentElement as HTMLElement;
    expect(line).not.toHaveAttribute("dir");
    expect(line.closest("[dir='ltr']")).toBeNull();
    expect(within(line.parentElement as HTMLElement).getByText("زيارة تنظيف")).toBeInTheDocument();
  });

  it("filters by kind from the first page", async () => {
    renderWithProviders(<ServicesScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    await screen.findByText("STANDARD_VISIT");
    await user.selectOptions(screen.getByLabelText("Kind"), "live_out");
    await waitFor(() => expect(api.fetchServices).toHaveBeenLastCalledWith({ page: 1, perPage: 25, kind: "live_out", isActive: undefined }));
  });

  it("creates a draft service and opens its page", async () => {
    api.createService.mockResolvedValue({ ...deepClean, id: 7, code: "SOFA_CLEAN", name: { ar: "تنظيف الكنب", en: "Sofa cleaning" } });
    renderWithProviders(<ServicesScreen />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New service" }));
    const dialog = await screen.findByRole("dialog", { name: "New service" });
    await user.type(within(dialog).getByLabelText(/^Code/), "sofa_clean");
    await user.selectOptions(within(dialog).getByLabelText(/^Kind/), "future_specialized");
    await user.type(within(dialog).getByLabelText(/^Name \(Arabic\)/), "تنظيف الكنب");
    await user.type(within(dialog).getByLabelText(/^Name \(English\)/), "Sofa cleaning");
    const duration = within(dialog).getByLabelText(/^Duration \(minutes\)/);
    await user.clear(duration);
    await user.type(duration, "100");
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "New line of business");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Use 15-minute steps between 15 and 1440 minutes.")).toBeInTheDocument();

    await user.clear(duration);
    await user.type(duration, "120");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.createService).toHaveBeenCalledTimes(1));
    expect(api.createService.mock.calls[0][0]).toEqual({
      code: "SOFA_CLEAN",
      kind: "future_specialized",
      name: { ar: "تنظيف الكنب", en: "Sofa cleaning" },
      duration_minutes: 120,
      min_workers: 1,
      max_workers: 4,
      materials_mode: "customer",
      is_active: false,
      is_bookable_online: true,
      reason: "New line of business",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/catalog/services/7"));
  });
});
