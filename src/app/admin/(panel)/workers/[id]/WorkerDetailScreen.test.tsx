import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { ShiftRow, Worker } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { WorkerDetailScreen } from "./WorkerDetailScreen";
import { editVersion } from "./workerShared";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/workers/1",
}));

const api = { fetchWorker: vi.fn(), updateWorker: vi.fn(), updateWorkerShifts: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchWorker: (...a: unknown[]) => api.fetchWorker(...a),
  updateWorker: (...a: unknown[]) => api.updateWorker(...a),
  updateWorkerShifts: (...a: unknown[]) => api.updateWorkerShifts(...a),
  fetchZoneOptions: async () => [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" }, is_active: true }],
  fetchServiceOptions: async () => [],
}));

// DemoWorkforceSeeder (R-14): Maria works every day but Friday, her rest day.
const week = (restDay: number): ShiftRow[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) =>
    d === restDay
      ? { day_of_week: d, is_working: false, start_time: null, end_time: null }
      : { day_of_week: d, is_working: true, start_time: "09:00", end_time: "20:00" },
  );

const maria: Worker = {
  id: 1,
  ulid: "01m5jm537rh4yrgc2hqg2e0s25",
  employee_no: "DEMO-W01",
  full_name: { ar: "ماريا سانتوس", en: "Maria Santos" },
  display_name: "Maria S.",
  phone: null,
  nationality: "PH",
  languages: ["en", "tl", "ar"],
  employment_status: "active",
  hired_at: "2026-09-01",
  home_zone_id: 1,
  home_zone: { id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري وداون تاون", en: "Business Bay & Downtown" } },
  can_live_out: true,
  weekly_rest_day: 5,
  notes: "Demo worker (R-14), not a real person.",
  shifts: week(5),
  upcoming_leaves: [],
  version: 4,
  created_at: null,
  updated_at: null,
};

// What PUT /shifts returns after the rest day moved to Saturday: Saturday off, Friday still off.
const movedRestDay: Worker = {
  ...maria,
  weekly_rest_day: 6,
  shifts: week(6).map((r) => (r.day_of_week === 5 ? { ...r, is_working: false, start_time: null, end_time: null } : r)),
  version: 5,
};

const consoleError = vi.spyOn(console, "error");

async function moveRestDayToSaturday(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Schedule" }));
  await user.selectOptions(await screen.findByRole("combobox", { name: "Weekly rest day" }), "6");
  await user.click(screen.getByRole("switch", { name: "Works on Saturday" }));
  await user.click(screen.getByRole("button", { name: "Save schedule" }));
  await waitFor(() => expect(api.updateWorkerShifts).toHaveBeenCalledWith(1, expect.objectContaining({ weekly_rest_day: 6 }), 4, undefined));
  await user.click(screen.getByRole("tab", { name: "Info" }));
}

describe("A05 worker tabs share one profile and one version (P1-04)", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchWorker.mockResolvedValue(maria);
    api.updateWorkerShifts.mockResolvedValue(movedRestDay);
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("an untouched Info form follows a rest day moved in Schedule, so its save does not move it back", async () => {
    api.updateWorker.mockImplementation(async (_id: number, payload: Partial<Worker>) => ({ ...movedRestDay, ...payload, version: 6 }));
    renderWithProviders(<WorkerDetailScreen id="1" />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();
    expect(await screen.findByRole("combobox", { name: "Weekly rest day" })).toHaveValue("5");

    await moveRestDayToSaturday(user);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weekly rest day" })).toHaveValue("6"));
    expect(screen.queryByText(/This profile changed after you started editing here/)).not.toBeInTheDocument();

    const name = screen.getByRole("textbox", { name: /^Display name/ });
    await user.clear(name);
    await user.type(name, "Maria");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateWorker).toHaveBeenCalledTimes(1));
    const [, payload, version] = api.updateWorker.mock.calls[0];
    expect(payload).toMatchObject({ display_name: "Maria", weekly_rest_day: 6 });
    expect(version).toBe(5);
  });

  it("edits in Info that predate the move keep the old version, so the API refuses them as stale", async () => {
    api.updateWorker.mockRejectedValue(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: {} }));
    renderWithProviders(<WorkerDetailScreen id="1" />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();

    const name = await screen.findByRole("textbox", { name: /^Display name/ });
    await user.clear(name);
    await user.type(name, "Maria");
    await moveRestDayToSaturday(user);

    // The edit is kept, the rest day it was based on too, and the tab says the profile moved on.
    expect(screen.getByRole("textbox", { name: /^Display name/ })).toHaveValue("Maria");
    expect(screen.getByRole("combobox", { name: "Weekly rest day" })).toHaveValue("5");
    expect(screen.getByText(/This profile changed after you started editing here/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateWorker).toHaveBeenCalledTimes(1));
    expect(api.updateWorker.mock.calls[0][2]).toBe(4);
    const stale = await screen.findByRole("dialog", { name: "This record was changed" });

    api.fetchWorker.mockResolvedValue(movedRestDay);
    await user.click(within(stale).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Weekly rest day" })).toHaveValue("6"));
    expect(screen.getByRole("textbox", { name: /^Display name/ })).toHaveValue("Maria S.");
  });
});

describe("editVersion", () => {
  const read = (w: Worker) => ({ restDay: w.weekly_rest_day, name: w.display_name });

  it("sends the cached version without edits, or when the tab's own fields did not change", () => {
    expect(editVersion(movedRestDay, null, read)).toEqual({ version: 5, conflict: false });
    expect(editVersion(maria, maria, read)).toEqual({ version: 4, conflict: false });
    const servicesSaved = { ...maria, version: 5 };
    expect(editVersion(servicesSaved, maria, read)).toEqual({ version: 5, conflict: false });
  });

  it("keeps the version the edits started from when the tab's own fields changed underneath", () => {
    expect(editVersion(movedRestDay, maria, read)).toEqual({ version: 4, conflict: true });
    // An older copy (a late refetch) never lowers the version.
    expect(editVersion(maria, movedRestDay, read)).toEqual({ version: 5, conflict: false });
  });
});
