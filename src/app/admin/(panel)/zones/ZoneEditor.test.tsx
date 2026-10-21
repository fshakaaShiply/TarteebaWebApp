import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { GeoPolygon } from "@/lib/admin/types";
import { businessBay } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { CreateZoneDialog, ZoneDrawer } from "./ZoneEditor";

const api = {
  fetchZone: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  deactivateZone: vi.fn(),
  createSubZone: vi.fn(),
  updateSubZone: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchZone: (...a: unknown[]) => api.fetchZone(...a),
  createZone: (...a: unknown[]) => api.createZone(...a),
  updateZone: (...a: unknown[]) => api.updateZone(...a),
  deactivateZone: (...a: unknown[]) => api.deactivateZone(...a),
  createSubZone: (...a: unknown[]) => api.createSubZone(...a),
  updateSubZone: (...a: unknown[]) => api.updateSubZone(...a),
}));

const JVC: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    [
      [55.2, 25.05],
      [55.22, 25.05],
      [55.22, 25.07],
      [55.2, 25.07],
      [55.2, 25.05],
    ],
  ],
};

async function fillZone(user: ReturnType<typeof userEvent.setup>, polygon: string) {
  const dialog = screen.getByRole("dialog", { name: "New zone" });
  await user.type(within(dialog).getByLabelText(/^Code/), "demo_jvc");
  await user.type(within(dialog).getByLabelText(/^Name \(Arabic\)/), "قرية جميرا الدائرية");
  await user.type(within(dialog).getByLabelText(/^Name \(English\)/), "JVC");
  const field = within(dialog).getByLabelText(/^Boundary \(GeoJSON\)/);
  await user.click(field);
  await user.paste(polygon);
  await user.type(within(dialog).getByLabelText(/Reason for the change/), "New service area");
  return dialog;
}

describe("A11 zones editor", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchZone.mockResolvedValue(businessBay);
  });

  it("checks the GeoJSON, draws the preview and creates the zone with the parsed polygon", async () => {
    api.createZone.mockResolvedValue({ ...businessBay, id: 5, code: "DEMO_JVC", polygon: JVC, sub_zones: [] });
    const onCreated = vi.fn();
    renderWithProviders(<CreateZoneDialog onClose={vi.fn()} onCreated={onCreated} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    const dialog = await fillZone(user, JSON.stringify(JVC));
    expect(within(dialog).getByText("Valid boundary with 4 points")).toBeInTheDocument();
    const preview = within(dialog).getByRole("img", { name: "Preview of the zone boundary" });
    expect(preview.querySelectorAll("path")).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.createZone).toHaveBeenCalledTimes(1));
    expect(api.createZone.mock.calls[0][0]).toEqual({
      code: "DEMO_JVC",
      name: { ar: "قرية جميرا الدائرية", en: "JVC" },
      polygon: JVC,
      default_travel_buffer_min: null,
      sort_order: 0,
      is_active: true,
      reason: "New service area",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("refuses an open ring before saving and shows POLYGON_INVALID with its reason", async () => {
    renderWithProviders(<CreateZoneDialog onClose={vi.fn()} onCreated={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();
    const open = { type: "Polygon", coordinates: [JVC.coordinates[0].slice(0, 4)] };

    const dialog = await fillZone(user, JSON.stringify(open));
    expect(within(dialog).getByText("Enter a valid boundary to see the preview.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("Each ring must end at the point where it starts.")).toBeInTheDocument();
    expect(api.createZone).not.toHaveBeenCalled();

    api.createZone.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "POLYGON_INVALID",
        message: "The zone boundary is not valid: a ring does not enclose any area.",
        details: { field: "polygon", reason: "degenerate_ring", path: "polygon.coordinates.0" },
      });
    });
    const field = within(dialog).getByLabelText(/^Boundary \(GeoJSON\)/);
    await user.clear(field);
    await user.click(field);
    await user.paste(JSON.stringify(JVC));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await within(dialog).findByText("A ring doesn't enclose any area. (at polygon.coordinates.0)")).toBeInTheDocument();
  });

  it("warns about a sub-zone point outside the zone and maps SUB_ZONE_OUTSIDE_ZONE", async () => {
    api.createSubZone.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "SUB_ZONE_OUTSIDE_ZONE",
        message: "Every point of a sub-zone must lie inside its zone.",
        details: { sub_zone_code: "DEMO_BB_MARINA", vertex: [55.3, 25.193] },
      });
    });
    renderWithProviders(<ZoneDrawer initial={businessBay} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    expect(await screen.findByText("DEMO_BB_DOWNTOWN")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add sub-zone" }));
    const dialog = await screen.findByRole("dialog", { name: "New sub-zone in Business Bay" });
    await user.type(within(dialog).getByLabelText(/^Code/), "demo_bb_marina");
    await user.type(within(dialog).getByLabelText(/^Name \(Arabic\)/), "المرسى");
    await user.type(within(dialog).getByLabelText(/^Name \(English\)/), "Marina");
    const outside = {
      type: "Polygon",
      coordinates: [
        [
          [55.27, 25.193],
          [55.3, 25.193],
          [55.28, 25.199],
          [55.27, 25.193],
        ],
      ],
    };
    const field = within(dialog).getByLabelText(/^Boundary \(GeoJSON\)/);
    await user.click(field);
    await user.paste(JSON.stringify(outside));
    expect(within(dialog).getByText(/This point is outside the zone: 55.3, 25.193/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason for the change/), "Marina range");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.createSubZone).toHaveBeenCalledTimes(1));
    expect(api.createSubZone.mock.calls[0][0]).toBe(1);
    expect(api.createSubZone.mock.calls[0][1]).toMatchObject({ code: "DEMO_BB_MARINA", polygon: outside, is_active: true });
    expect(
      await within(dialog).findByText("Sub-zone DEMO_BB_MARINA has a point outside its zone: 55.3, 25.193."),
    ).toBeInTheDocument();
  });

  it("deactivates a zone only after a confirmation with a reason", async () => {
    api.deactivateZone.mockResolvedValue({ ...businessBay, is_active: false, version: 2 });
    renderWithProviders(<ZoneDrawer initial={businessBay} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Deactivate zone" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Deactivate DEMO_BB?" });
    expect(within(confirm).getByText(/3 saved addresses are in this zone/)).toBeInTheDocument();
    await user.type(within(confirm).getByLabelText(/^Reason/), "Pilot area closed");
    await user.click(within(confirm).getByRole("button", { name: "Deactivate zone" }));

    await waitFor(() => expect(api.deactivateZone).toHaveBeenCalledWith(1, 1, "Pilot area closed"));
    expect(await screen.findByText("Zone DEMO_BB deactivated.")).toBeInTheDocument();
  });

  it("saves zone edits with If-Match version and without is_active", async () => {
    api.updateZone.mockResolvedValue({ ...businessBay, sort_order: 5, version: 2 });
    renderWithProviders(<ZoneDrawer initial={businessBay} onClose={vi.fn()} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    const order = await screen.findByLabelText(/^Display order/);
    await user.clear(order);
    await user.type(order, "5");
    await user.type(screen.getAllByLabelText(/Reason for the change/)[0], "Show first");
    await user.click(screen.getByRole("button", { name: "Save zone" }));

    await waitFor(() => expect(api.updateZone).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updateZone.mock.calls[0];
    expect([id, version]).toEqual([1, 1]);
    expect(body).toEqual({
      code: "DEMO_BB",
      name: businessBay.name,
      polygon: businessBay.polygon,
      default_travel_buffer_min: null,
      sort_order: 5,
      reason: "Show first",
    });
  });
});
