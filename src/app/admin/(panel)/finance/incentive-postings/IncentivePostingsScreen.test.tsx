import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { posting } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { IncentivePostingScreen } from "./[id]/IncentivePostingScreen";
import { IncentivePostingsScreen } from "./IncentivePostingsScreen";

const url = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(next: string) {
      params = new URLSearchParams(next);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePathname: () => "/admin/finance/incentive-postings",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = { fetchPostings: vi.fn(), fetchPosting: vi.fn(), fetchPostingFile: vi.fn() };
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchPostings: (...a: unknown[]) => api.fetchPostings(...a),
  fetchPosting: (...a: unknown[]) => api.fetchPosting(...a),
  fetchPostingFile: (...a: unknown[]) => api.fetchPostingFile(...a),
}));

const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string) => new AdminApiError(status, { code, message: "", details: {} });
const page = (data: ReturnType<typeof posting>[]) => ({ data, meta: { current_page: 1, per_page: 25, total: data.length, last_page: 1 } });
const withLines = (over: Partial<ReturnType<typeof posting>> = {}) => ({
  ...posting(over),
  lines: [
    { kind: "incentive" as const, proposal_id: 1, adjustment_id: null, worker: { id: 3, employee_no: "DEMO-W01", full_name: { ar: "ماريا سانتوس", en: "Maria Santos" } }, amount_fils: 40000 },
    { kind: "incentive" as const, proposal_id: 2, adjustment_id: null, worker: { id: 4, employee_no: "DEMO-W02", full_name: { ar: "سيتي رحمة", en: "Siti Rahma" } }, amount_fils: 50000 },
    { kind: "adjustment" as const, proposal_id: null, adjustment_id: 4, worker: { id: 3, employee_no: "DEMO-W01", full_name: { ar: "ماريا سانتوس", en: "Maria Santos" } }, amount_fils: -5000 },
  ],
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  url.set("");
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
});

describe("A09 incentive postings list (workforce §5.6)", () => {
  it("lists the postings with reference, month, lines, signed total, who posted and when", async () => {
    api.fetchPostings.mockResolvedValue(page([posting(), posting({ id: 2, reference: "INC-2026-08-01", period: { start: "2026-08-01", end: "2026-08-31" }, total_fils: -1500, lines_count: 1, posted_by: null })]));
    renderWithProviders(<IncentivePostingsScreen />, { permissions: ["incentives.view"] });
    await screen.findByText("INC-2026-08-01");
    const rows = within(screen.getByRole("table", { name: "Incentive postings" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("INC-2026-09-01");
    expect(rows[1]).toHaveTextContent("September 2026");
    expect(rows[1]).toHaveTextContent("AED 900.00");
    expect(rows[1]).toHaveTextContent("Huda HR");
    expect(screen.getByRole("link", { name: "INC-2026-09-01" })).toHaveAttribute("href", "/admin/finance/incentive-postings/1");
    expect(rows[2]).toHaveTextContent("AED -15.00");
    expect(rows[2]).toHaveTextContent("—");
  });

  it("filters by month in the address and asks the API for it", async () => {
    api.fetchPostings.mockResolvedValue(page([posting()]));
    renderWithProviders(<IncentivePostingsScreen />, { permissions: ["incentives.view"] });
    const user = userEvent.setup();
    await screen.findByText("INC-2026-09-01");
    expect(api.fetchPostings).toHaveBeenLastCalledWith({ period: undefined, page: 1 });
    await user.selectOptions(screen.getByRole("combobox", { name: "Month" }), "2026-08");
    expect(await screen.findByText("INC-2026-09-01")).toBeInTheDocument();
    expect(api.fetchPostings).toHaveBeenLastCalledWith({ period: "2026-08", page: 1 });
  });

  it("is readable by the accountant (incentives.view) and by HR (incentives.approve), and by nobody else", () => {
    api.fetchPostings.mockResolvedValue(page([]));
    const { unmount } = renderWithProviders(<IncentivePostingsScreen />, { permissions: ["incentives.approve"] });
    expect(api.fetchPostings).toHaveBeenCalled();
    unmount();
    api.fetchPostings.mockClear();
    renderWithProviders(<IncentivePostingsScreen />, { permissions: ["payments.view"] });
    expect(api.fetchPostings).not.toHaveBeenCalled();
  });

  it("has an empty state and an error state with a retry", async () => {
    api.fetchPostings.mockResolvedValueOnce(page([]));
    const { unmount } = renderWithProviders(<IncentivePostingsScreen />, { permissions: ["incentives.view"] });
    expect(await screen.findByText("No postings yet.")).toBeInTheDocument();
    unmount();
    api.fetchPostings.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(page([posting()]));
    renderWithProviders(<IncentivePostingsScreen />, { permissions: ["incentives.view"] });
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("INC-2026-09-01")).toBeInTheDocument();
  });
});

describe("A09 one incentive posting", () => {
  it("shows the lines, each an incentive or an adjustment with its signed amount, and the total", async () => {
    api.fetchPosting.mockResolvedValue(withLines());
    renderWithProviders(<IncentivePostingScreen id="1" />, { permissions: ["incentives.view"] });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("INC-2026-09-01");
    const rows = within(screen.getByRole("table", { name: "Lines of the posting" })).getAllByRole("row");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent("Maria Santos");
    expect(rows[1]).toHaveTextContent("DEMO-W01");
    expect(rows[1]).toHaveTextContent("Incentive");
    expect(rows[1]).toHaveTextContent("AED 400.00");
    expect(rows[3]).toHaveTextContent("Adjustment");
    expect(rows[3]).toHaveTextContent("AED -50.00");
    expect(screen.getByRole("heading", { name: "Lines" }).closest("section")).toHaveTextContent("AED 900.00");
    expect(screen.getByText(/September 2026 · posted by Huda HR on/)).toBeInTheDocument();
    expect(screen.getByText("A posting is final: a correction is an adjustment posted later.")).toBeInTheDocument();
  });

  it("gives the CSV through a fresh signed link, asked for on click", async () => {
    api.fetchPosting.mockResolvedValue(withLines());
    api.fetchPostingFile.mockResolvedValue({ url: "https://files.test/INC-2026-09-01.csv", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), file_name: "INC-2026-09-01.csv" });
    renderWithProviders(<IncentivePostingScreen id="1" />, { permissions: ["incentives.view"] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Download CSV/ }));
    expect(api.fetchPostingFile).toHaveBeenCalledWith(1);
    const link = await screen.findByRole("link", { name: /INC-2026-09-01/ });
    expect(link).toHaveAttribute("href", "https://files.test/INC-2026-09-01.csv");
    expect(link).toHaveAttribute("download", "INC-2026-09-01.csv");
  });

  it("says 404 for an id that is not a number without asking, and shows the API's error with a retry", async () => {
    const { unmount } = renderWithProviders(<IncentivePostingScreen id="abc" />, { permissions: ["incentives.view"] });
    expect(api.fetchPosting).not.toHaveBeenCalled();
    expect(await screen.findByRole("link", { name: "All postings" })).toHaveAttribute("href", "/admin/finance/incentive-postings");
    unmount();
    api.fetchPosting.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValue(withLines());
    renderWithProviders(<IncentivePostingScreen id="1" />, { permissions: ["incentives.view"] });
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("INC-2026-09-01");
  });

  it("is written in Arabic with the reference kept left to right", async () => {
    api.fetchPosting.mockResolvedValue(withLines());
    renderWithProviders(<IncentivePostingScreen id="1" />, { permissions: ["incentives.view"], locale: "ar" });
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.querySelector('bdi[dir="ltr"]')).toHaveTextContent("INC-2026-09-01");
    expect(screen.getAllByText("تسوية").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ماريا سانتوس", { selector: "bdi" }).length).toBe(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
