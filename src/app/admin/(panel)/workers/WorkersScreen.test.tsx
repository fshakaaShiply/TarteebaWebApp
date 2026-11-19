import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { worker } from "@/test/workforceFixtures";
import { WorkersScreen } from "./WorkersScreen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/workers",
}));

const api = { fetchWorkers: vi.fn(), fetchDashboardSummary: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchWorkers: (...a: unknown[]) => api.fetchWorkers(...a),
  fetchDashboardSummary: (...a: unknown[]) => api.fetchDashboardSummary(...a),
  createWorker: vi.fn(),
  fetchZoneOptions: async () => [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true }],
  fetchServiceOptions: async () => [],
  fetchSkills: async () => [],
}));

const consoleError = vi.spyOn(console, "error");
const page = (data: Worker[]) => ({ data, meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1 } });
const maria = worker({
  week_minutes: 2400,
  rating: { average: 4.9, count: 20 },
  photo_url: "https://files.test/photo.jpg?sig=1",
  alert: { document_id: 7, type: "residency", type_label: { ar: "تأشيرة الإقامة", en: "Residency visa" }, expires_at: "2026-11-13", days_left: 21, state: "expiring" },
  alerts_count: 2,
});
const siti = worker({
  id: 4,
  employee_no: "DEMO-W02",
  display_name: "Siti R.",
  full_name: { ar: "سيتي رحمة", en: "Siti Rahma" },
  week_minutes: 450,
  rating: null,
  photo_url: null,
  alert: { document_id: 8, type: "passport", type_label: { ar: "جواز السفر", en: "Passport" }, expires_at: "2026-09-01", days_left: null, state: "expired" },
  alerts_count: 1,
});
const rowOf = (name: string) => screen.getAllByRole("row").find((r) => r.textContent?.includes(name))!;

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  api.fetchWorkers.mockResolvedValue(page([maria, siti]));
  api.fetchDashboardSummary.mockResolvedValue({ panels: { workers: { available: 9 } } });
});

describe("A05 workers list, Phase 5 columns (workforce §7.1)", () => {
  it("shows the week's hours, the rating with its count, and her photo or her initial", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view"] });
    await screen.findByText("Maria S.");
    const mariaRow = rowOf("Maria S.");
    expect(mariaRow).toHaveTextContent("40 h");
    expect(mariaRow).toHaveTextContent("★ 4.9 · 20 ratings");
    expect(mariaRow.querySelector("img")).toHaveAttribute("src", "https://files.test/photo.jpg?sig=1");
    expect(mariaRow.querySelector("img")).toHaveAttribute("referrerpolicy", "no-referrer");
    const sitiRow = rowOf("Siti R.");
    expect(sitiRow).toHaveTextContent("7.5 h");
    // No rating yet: a dash, not a zero. No photo: her initial.
    expect(within(sitiRow).getAllByText("—").length).toBeGreaterThan(0);
    expect(sitiRow.querySelector("img")).toBeNull();
    expect(within(sitiRow).getByText("S", { selector: "span" })).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the document alert column and filter only to HR, with the chip's days and how many more", async () => {
    const { unmount } = renderWithProviders(<WorkersScreen />, { permissions: ["workers.view"] });
    await screen.findByText("Maria S.");
    expect(screen.queryByRole("columnheader", { name: "Document alert" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Documents" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "workers.documents"] });
    await screen.findByText("Maria S.");
    expect(screen.getByRole("columnheader", { name: "Document alert" })).toBeInTheDocument();
    expect(rowOf("Maria S.")).toHaveTextContent("Residency visa expires in 21 days");
    expect(rowOf("Maria S.")).toHaveTextContent("+1 more");
    expect(rowOf("Siti R.")).toHaveTextContent("Passport expired");
  });

  it("says a document expires today on the day itself", async () => {
    api.fetchWorkers.mockResolvedValue(page([worker({ alert: { document_id: 7, type: "emirates_id", type_label: { ar: "الهوية", en: "Emirates ID" }, expires_at: "2026-10-23", days_left: 0, state: "expiring" }, alerts_count: 1 })]));
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "workers.documents"] });
    expect(await screen.findByText("Emirates ID expires today")).toBeInTheDocument();
  });

  it("filters to the workers with a document alert (alert=documents)", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "workers.documents"] });
    const user = userEvent.setup();
    await screen.findByText("Maria S.");
    expect(api.fetchWorkers).toHaveBeenLastCalledWith(expect.objectContaining({ alert: undefined }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Documents" }), "documents");
    await waitFor(() => expect(api.fetchWorkers).toHaveBeenLastCalledWith(expect.objectContaining({ alert: "documents" })));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(api.fetchWorkers).toHaveBeenLastCalledWith(expect.objectContaining({ alert: undefined })));
  });

  it("writes how many cleaners there are and, for those who read the overview, how many are available today", async () => {
    const { unmount } = renderWithProviders(<WorkersScreen />, { permissions: ["workers.view"] });
    expect(await screen.findByText("2 cleaners")).toBeInTheDocument();
    expect(api.fetchDashboardSummary).not.toHaveBeenCalled();
    unmount();
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "bookings.view"] });
    expect(await screen.findByText("2 cleaners · 9 available today")).toBeInTheDocument();
  });

  it("is written in Arabic", async () => {
    renderWithProviders(<WorkersScreen />, { permissions: ["workers.view", "workers.documents", "bookings.view"], locale: "ar" });
    await screen.findByText("Maria S.");
    expect(await screen.findByText("عاملتان · 9 متاحة اليوم")).toBeInTheDocument();
    expect(rowOf("Maria S.")).toHaveTextContent("تنتهي خلال 21 يومًا");
    expect(rowOf("Siti R.")).toHaveTextContent("جواز السفر: منتهية");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
