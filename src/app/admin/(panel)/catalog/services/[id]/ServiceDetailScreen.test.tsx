import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedChangesProvider } from "@/components/admin";
import { AdminApiError } from "@/lib/admin/client";
import type { CatalogService, Policy } from "@/lib/admin/types";
import { businessBay, policies, servicePreview, standardPrice, standardService } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { ServiceDetailScreen } from "./ServiceDetailScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/catalog/services/1",
}));

const api = {
  fetchService: vi.fn(),
  fetchAllPolicies: vi.fn(),
  fetchAllZones: vi.fn(),
  fetchAllServices: vi.fn(),
  previewCatalog: vi.fn(),
  updateService: vi.fn(),
  createServicePrice: vi.fn(),
  updateServicePrice: vi.fn(),
  deleteServicePrice: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchService: (...a: unknown[]) => api.fetchService(...a),
  fetchAllPolicies: (...a: unknown[]) => api.fetchAllPolicies(...a),
  fetchAllZones: (...a: unknown[]) => api.fetchAllZones(...a),
  fetchAllServices: (...a: unknown[]) => api.fetchAllServices(...a),
  previewCatalog: (...a: unknown[]) => api.previewCatalog(...a),
  updateService: (...a: unknown[]) => api.updateService(...a),
  createServicePrice: (...a: unknown[]) => api.createServicePrice(...a),
  updateServicePrice: (...a: unknown[]) => api.updateServicePrice(...a),
  deleteServicePrice: (...a: unknown[]) => api.deleteServicePrice(...a),
}));

function open(permissions: string[] = ["catalog.manage"], locale: "ar" | "en" = "en") {
  renderWithProviders(
    <UnsavedChangesProvider navigate={push}>
      <ServiceDetailScreen id="1" />
    </UnsavedChangesProvider>,
    { permissions, locale },
  );
  return userEvent.setup();
}

/** The public payload after deleting the only price: no "from" price any more. */
const withoutPrice = {
  ...servicePreview,
  payload: {
    ar: { ...servicePreview.payload.ar, price_from_fils: null, price_unit: null },
    en: { ...servicePreview.payload.en, price_from_fils: null, price_unit: null },
  },
  price_examples: [],
};

describe("A11 service page", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    push.mockReset();
    api.fetchService.mockResolvedValue(standardService);
    api.fetchAllPolicies.mockResolvedValue(policies);
    api.fetchAllZones.mockResolvedValue([businessBay]);
    api.fetchAllServices.mockResolvedValue([standardService]);
  });

  it("previews the unsaved General values side by side in Arabic and English, without saving", async () => {
    api.previewCatalog.mockResolvedValue(servicePreview);
    const user = open();

    const nameEn = await screen.findByLabelText(/^Name \(English\)/);
    expect(nameEn).toHaveValue("Cleaning visit");
    await user.clear(nameEn);
    await user.type(nameEn, "Cleaning visit (4 hours)");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(api.previewCatalog).toHaveBeenCalledTimes(1));
    const request = api.previewCatalog.mock.calls[0][0];
    expect(request.service_code).toBe("STANDARD_VISIT");
    expect(request.service).toMatchObject({
      name: { ar: "زيارة تنظيف", en: "Cleaning visit (4 hours)" },
      includes: standardService.includes,
      duration_minutes: 240,
      cancellation_policy_id: 1,
    });
    expect(request.service).not.toHaveProperty("reason");
    expect(api.updateService).not.toHaveBeenCalled();

    const arabic = await screen.findByRole("region", { name: "Arabic" });
    const english = screen.getByRole("region", { name: "English" });
    expect(within(arabic).getByRole("heading", { name: "زيارة تنظيف (4 ساعات)" })).toBeInTheDocument();
    expect(within(arabic).getByText(/ابتداءً من 120 د.إ للعاملة/)).toBeInTheDocument();
    expect(within(english).getByRole("heading", { name: "Cleaning visit (4 hours)" })).toBeInTheDocument();
    expect(within(english).getByText(/From AED 120 per worker/)).toBeInTheDocument();
    expect(within(english).getByText(/VAT included/)).toBeInTheDocument();
    expect(within(english).getByText("2 workers = AED 240 (AED 228.57 + VAT AED 11.43)")).toBeInTheDocument();
    expect(within(english).getByText("Once a week")).toBeInTheDocument();

    // Editing after the preview marks it as outdated.
    await user.type(nameEn, "!");
    expect(screen.getByText(/You changed the form after this preview/)).toBeInTheDocument();
  });

  it("shows preview validation messages from the API on the fields", async () => {
    api.previewCatalog.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "VALIDATION_FAILED",
        message: "Some fields need your attention.",
        details: { fields: { "service.duration_minutes": ["The duration must be a multiple of 15."] } },
      });
    });
    const user = open();
    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(await screen.findAllByText("The duration must be a multiple of 15.")).not.toHaveLength(0);
    expect(screen.getByLabelText(/^Duration \(minutes\)/)).toHaveAttribute("aria-invalid", "true");
  });

  it("saves with the loaded version and a required reason", async () => {
    const saved: CatalogService = { ...standardService, version: 2, is_bookable_online: false };
    api.updateService.mockResolvedValue(saved);
    const user = open();

    await user.click(await screen.findByRole("switch", { name: "Bookable online" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter the reason for this change.")).toBeInTheDocument();
    expect(api.updateService).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Reason for the change/), "Phone bookings only for now");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updateService).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updateService.mock.calls[0];
    expect(id).toBe(1);
    expect(version).toBe(1);
    expect(body).toMatchObject({ is_bookable_online: false, reason: "Phone bookings only for now", min_workers: 1, max_workers: 4 });
    expect(await screen.findByText("Cleaning visit saved.")).toBeInTheDocument();
  });

  it("asks to reload after STALE_VERSION", async () => {
    api.updateService.mockImplementation(async () => {
      throw new AdminApiError(409, { code: "STALE_VERSION", message: "", details: { current_version: 2 } });
    });
    const user = open();

    await user.click(await screen.findByRole("switch", { name: "Needs equipment" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const dialog = await screen.findByRole("dialog", { name: "This record was changed" });
    await user.click(within(dialog).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(api.fetchService).toHaveBeenCalledTimes(2));
  });

  it("adds a price in AED and sends integer fils", async () => {
    api.createServicePrice.mockResolvedValue({ ...standardPrice, id: 2, amount_fils: 13050, zone_id: 1 });
    const user = open();

    await user.click(await screen.findByRole("tab", { name: "Prices" }));
    expect(screen.getByText("All zones")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add price" }));

    const dialog = await screen.findByRole("dialog", { name: "Add price" });
    await user.selectOptions(within(dialog).getByLabelText("Zone"), "1");
    await user.type(within(dialog).getByLabelText(/^Amount/), "130.5");
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "Business Bay rate");
    await user.click(within(dialog).getByRole("button", { name: "Save price" }));

    await waitFor(() => expect(api.createServicePrice).toHaveBeenCalledTimes(1));
    expect(api.createServicePrice.mock.calls[0][0]).toEqual({
      service_id: 1,
      zone_id: 1,
      day_of_week: null,
      valid_from: null,
      valid_to: null,
      unit: "per_worker_visit",
      amount_fils: 13050,
      vat_inclusive: true,
      priority: 0,
      reason: "Business Bay rate",
    });
  });

  it("previews an edited price row before saving it", async () => {
    api.previewCatalog.mockResolvedValue(servicePreview);
    const user = open();

    await user.click(await screen.findByRole("tab", { name: "Prices" }));
    await user.click(screen.getByRole("button", { name: "Edit the price for All zones" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit price" });
    const amount = within(dialog).getByLabelText(/^Amount/);
    expect(amount).toHaveValue("120.00");
    await user.clear(amount);
    await user.type(amount, "99.99");
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));

    // React Query passes its own context as a second argument: compare the request only.
    await waitFor(() => expect(api.previewCatalog).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(api.previewCatalog.mock.calls[0][0]).toEqual({
        service_code: "STANDARD_VISIT",
        prices: [
          {
            id: 1,
            zone_id: null,
            day_of_week: null,
            valid_from: null,
            valid_to: null,
            unit: "per_worker_visit",
            amount_fils: 9999,
            vat_inclusive: true,
            priority: 0,
          },
        ],
      }),
    );
    expect(await within(dialog).findByRole("region", { name: "English" })).toBeInTheDocument();
    expect(api.updateServicePrice).not.toHaveBeenCalled();
  });

  it("deletes a price only after a confirmation with a reason", async () => {
    api.deleteServicePrice.mockResolvedValue(undefined);
    api.previewCatalog.mockResolvedValue(servicePreview);
    const user = open();

    await user.click(await screen.findByRole("tab", { name: "Prices" }));
    await user.click(screen.getByRole("button", { name: "Delete the price for All zones" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this price?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(await within(confirm).findByText("Enter the reason for this change.")).toBeInTheDocument();
    expect(api.deleteServicePrice).not.toHaveBeenCalled();

    api.fetchService.mockResolvedValue({ ...standardService, prices: [] });
    await user.type(within(confirm).getByLabelText(/Reason for deleting/), "Replaced by zone prices");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteServicePrice).toHaveBeenCalledWith(1, 1, "Replaced by zone prices"));
    expect(await screen.findByText("No prices yet.")).toBeInTheDocument();
  });

  it("lists the packages of a standard visit in their own tab", async () => {
    const user = open();
    await user.click(await screen.findByRole("tab", { name: "Packages" }));
    expect(screen.getByText("WEEKLY_1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All packages" })).toHaveAttribute("href", "/admin/catalog/packages");
  });

  it("previews a delete from the confirmation and warns when the service loses its from-price", async () => {
    api.previewCatalog.mockResolvedValue(withoutPrice);
    const user = open();

    await user.click(await screen.findByRole("tab", { name: "Prices" }));
    await user.click(screen.getByRole("button", { name: "Delete the price for All zones" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this price?" });

    expect(await within(confirm).findByText("Customers will see no price")).toBeInTheDocument();
    expect(within(confirm).getByText('After this delete, Cleaning visit has no "from" price for customers until another price applies.')).toBeInTheDocument();
    expect(api.previewCatalog.mock.calls[0][0]).toEqual({ service_code: "STANDARD_VISIT", prices: [{ id: 1, delete: true }] });

    await user.click(within(confirm).getByRole("button", { name: "Show the preview" }));
    const english = await within(confirm).findByRole("region", { name: "English" });
    expect(within(english).getByText("Price not available yet")).toBeInTheDocument();
    expect(within(confirm).getByText(/Nothing has been deleted yet/)).toBeInTheDocument();
    expect(api.deleteServicePrice).not.toHaveBeenCalled();
  });

  it("says what customers keep seeing when another price still applies", async () => {
    api.previewCatalog.mockResolvedValue(servicePreview);
    const user = open();

    await user.click(await screen.findByRole("tab", { name: "Prices" }));
    await user.click(screen.getByRole("button", { name: "Delete the price for All zones" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Delete this price?" });
    expect(await within(confirm).findByText("After this delete, customers see: From AED 120 per worker.")).toBeInTheDocument();
    expect(within(confirm).queryByText("Customers will see no price")).not.toBeInTheDocument();
  });

  it("keeps the stored policy when the policy options arrive after the form", async () => {
    let resolvePolicies: (list: Policy[]) => void = () => undefined;
    api.fetchAllPolicies.mockReturnValue(new Promise<Policy[]>((resolve) => (resolvePolicies = resolve)));
    api.updateService.mockResolvedValue({ ...standardService, version: 2 });
    const user = open();

    const cancellation = await screen.findByLabelText("Cancellation policy");
    expect(cancellation).toBeDisabled();
    resolvePolicies(policies);
    await waitFor(() => expect(cancellation).toHaveValue("1"));
    expect(screen.getByLabelText("Reschedule policy")).toHaveValue("2");
    expect(screen.getByLabelText("Refund policy")).toHaveValue("3");

    // Focus and leave the select (a blur used to write the placeholder's empty value back), then save.
    fireEvent.focus(cancellation);
    fireEvent.blur(cancellation);
    await user.click(screen.getByRole("switch", { name: "Needs equipment" }));
    await user.type(screen.getByLabelText(/Reason for the change/), "Equipment needed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateService).toHaveBeenCalledTimes(1));
    expect(api.updateService.mock.calls[0][1]).toMatchObject({ cancellation_policy_id: 1, reschedule_policy_id: 2, refund_policy_id: 3 });
  });

  it("keeps unsaved General edits across tabs and asks before leaving the page", async () => {
    const user = open();
    const nameEn = await screen.findByLabelText(/^Name \(English\)/);
    await user.clear(nameEn);
    await user.type(nameEn, "Cleaning visit (draft)");

    await user.click(screen.getByRole("tab", { name: "Prices" }));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByLabelText(/^Name \(English\)/)).toHaveValue("Cleaning visit (draft)");

    // Reload / close: the browser's own warning.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await user.click(screen.getByRole("link", { name: "All services" }));
    const ask = await screen.findByRole("alertdialog", { name: "Leave without saving?" });
    await user.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Name \(English\)/)).toHaveValue("Cleaning visit (draft)");

    await user.click(screen.getByRole("link", { name: "All services" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).getByRole("button", { name: "Leave without saving" }));
    expect(push).toHaveBeenCalledWith("/admin/catalog/services");
  });

  it("does not ask before leaving when nothing changed", async () => {
    open();
    await screen.findByLabelText(/^Name \(English\)/);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);

    const link = screen.getByRole("link", { name: "All services" });
    let reachedLink = false;
    // Stands in for next/link's navigation (jsdom cannot navigate); runs only if no guard stopped the click.
    link.addEventListener("click", (e) => {
      reachedLink = !e.defaultPrevented;
      e.preventDefault();
    });
    fireEvent.click(link);
    expect(reachedLink).toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("links each include row's error to its input", async () => {
    const user = open();
    const ar = await screen.findByLabelText("What's included, item 1 (Arabic)");
    await user.clear(ar);
    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(ar).toHaveAttribute("aria-invalid", "true"));
    expect(ar).toHaveAccessibleDescription("Fill in both languages for this item, or remove it.");
    expect(screen.getByLabelText("What's included, item 1 (English)")).not.toHaveAttribute("aria-describedby");
  });

  it("shows the API's field message only in the UI language, otherwise our own copy", async () => {
    api.previewCatalog.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "VALIDATION_FAILED",
        message: "",
        details: {
          fields: {
            "service.duration_minutes": ["The service.duration minutes field must be a multiple of 15."],
            "service.max_workers": ["يجب ألا يقل الحد الأقصى للعاملات عن الحد الأدنى."],
          },
        },
      });
    });
    const user = open(["catalog.manage"], "ar");
    await user.click(await screen.findByRole("button", { name: "معاينة" }));

    const duration = await screen.findByLabelText(/^المدة \(بالدقائق\)/);
    await waitFor(() => expect(duration).toHaveAttribute("aria-invalid", "true"));
    expect(duration).toHaveAccessibleDescription("تحقّق من هذه القيمة.");
    expect(screen.getByLabelText(/^الحد الأقصى للعاملات/)).toHaveAccessibleDescription("يجب ألا يقل الحد الأقصى للعاملات عن الحد الأدنى.");
    expect(screen.queryByText(/must be a multiple of 15/)).not.toBeInTheDocument();
  });

  it("shows no data without catalog.manage", async () => {
    open(["bookings.view"]);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchService).not.toHaveBeenCalled();
  });
});
