import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { ratingDetail, ratingRow } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { RatingsScreen } from "./RatingsScreen";

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
    usePathname: () => "/admin/quality/ratings",
    useSearchParams: () => useSyncExternalStore(url.subscribe, url.get, url.get),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  };
});

const api = vi.hoisted(() => ({ fetchRatings: vi.fn(), fetchRating: vi.fn(), setRatingExcluded: vi.fn() }));
vi.mock("@/lib/admin/quality/endpoints", () => api);

const MANAGER = ["complaints.manage", "bookings.view", "customers.view"];
const page = (rows = [ratingRow()], over: Record<string, unknown> = {}) => ({ data: rows, meta: { current_page: 1, per_page: 25, total: rows.length, last_page: 1, average: 3.4, count: 128, ...over } });
const apiError = (status: number, code: string) => new AdminApiError(status, { code, message: "api words", details: {} });

beforeEach(() => {
  url.set("");
  Object.values(api).forEach((fn) => fn.mockReset());
  vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, target) => url.set(String(target ?? "").split("?")[1] ?? ""));
  api.fetchRatings.mockResolvedValue(page());
  api.fetchRating.mockResolvedValue(ratingDetail());
});
afterEach(() => vi.restoreAllMocks());

describe("the ratings list", () => {
  it("shows each rating with the cleaner it counts for, its flags, the comment and the case it opened", async () => {
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    const row = within((await screen.findByRole("link", { name: "TRB-R4RYSD" })).closest("tr")!);
    expect(row.getByRole("img", { name: "2 out of 5" })).toBeInTheDocument();
    expect(row.getByText("Low")).toBeInTheDocument();
    expect(row.getByText("Maria S.")).toBeInTheDocument();
    expect(row.getByText("“The bathroom was not clean.”")).toBeInTheDocument();
    expect(row.getByText("1 photo")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "TC-4XQ8NM" })).toHaveAttribute("href", "/admin/quality/7");
    expect(row.getByRole("link", { name: "Laila Hassan" })).toHaveAttribute("href", "/admin/customers/01JC0000000000000000000001");
  });

  it("shows the average the API counted and how many ratings it is made of", async () => {
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    expect(await screen.findByText("128 ratings counted")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3.4 out of 5" })).toBeInTheDocument();
  });

  it("passes the URL's filters on in the API's words", async () => {
    url.set("low=1&has_comment=1&kind=live_out_day&from=2026-10-01&to=2026-10-20&worker_id=3");
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    await waitFor(() => expect(api.fetchRatings).toHaveBeenCalled());
    expect(api.fetchRatings.mock.calls[0][0]).toMatchObject({ low: true, hasComment: true, kind: "live_out_day", from: "2026-10-01", to: "2026-10-20", workerId: 3, excluded: false });
    expect(screen.getByText("Only cases about cleaner no. 3")).toBeInTheDocument();
  });

  it("does not ask for a range that ends before it starts", async () => {
    url.set("from=2026-10-20&to=2026-10-01");
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    expect(await screen.findByText("The end date is before the start date.")).toBeInTheDocument();
    expect(api.fetchRatings).not.toHaveBeenCalled();
  });

  it("says when there are none, and offers a retry on an error", async () => {
    api.fetchRatings.mockResolvedValueOnce(page([], { average: null, count: 0 }));
    const { unmount } = renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    expect(await screen.findByText("No ratings yet")).toBeInTheDocument();
    unmount();
    api.fetchRatings.mockRejectedValueOnce(apiError(500, "SERVER_ERROR"));
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "TRB-R4RYSD" })).toBeInTheDocument();
  });

  it("is for complaints.manage only", () => {
    renderWithProviders(<RatingsScreen />, { permissions: ["compensation.approve"] });
    expect(api.fetchRatings).not.toHaveBeenCalled();
  });
});

describe("a rating's drawer and its exclusion", () => {
  async function openDrawer(detail = ratingDetail()) {
    api.fetchRating.mockResolvedValue(detail);
    renderWithProviders(<RatingsScreen />, { permissions: MANAGER });
    await userEvent.click(await screen.findByRole("button", { name: "Open the rating of TRB-R4RYSD" }));
    return screen.findByRole("dialog", { name: /Rating of TRB-R4RYSD/ });
  }

  it("shows the scores, the whole comment and the photo as a signed link", async () => {
    const drawer = within(await openDrawer());
    expect(await drawer.findByText("“The bathroom was not clean.”")).toBeInTheDocument();
    expect(drawer.getByText("Quality")).toBeInTheDocument();
    expect(drawer.getByRole("link", { name: /Photo 1/ })).toHaveAttribute("href", "https://files.example.test/signed/a1?sig=abc");
    expect(drawer.getByText(/is never changed or deleted|never changed or deleted/)).toBeInTheDocument();
  });

  it("leaves a rating out of the averages with a reason, sending the version it read", async () => {
    const drawer = within(await openDrawer());
    api.setRatingExcluded.mockResolvedValue(ratingDetail({ excluded: true, version: 3 }));
    await userEvent.click(await drawer.findByRole("button", { name: "Leave it out of the averages" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Leave this rating out" }));
    await userEvent.click(dialog.getByRole("button", { name: "Leave it out" }));
    expect(await dialog.findByText("Write a reason.")).toBeInTheDocument();
    expect(api.setRatingExcluded).not.toHaveBeenCalled();
    await userEvent.type(dialog.getByLabelText(/^Reason/), "The customer was away");
    await userEvent.click(dialog.getByRole("button", { name: "Leave it out" }));
    await waitFor(() => expect(api.setRatingExcluded).toHaveBeenCalledWith(21, true, "The customer was away", 2));
    expect(await screen.findByText("The rating is left out of the averages")).toBeInTheDocument();
  });

  it("counts an excluded rating again, and shows who left it out and why", async () => {
    const excluded = ratingDetail({ excluded: true, exclusion: { at: "2026-10-23T14:00:00+00:00", by: { id: 4, name: "Omar" }, reason: "The customer was away" } });
    const drawer = within(await openDrawer(excluded));
    expect(await drawer.findByText("Left out of every average")).toBeInTheDocument();
    expect(drawer.getByText("“The customer was away”")).toBeInTheDocument();
    api.setRatingExcluded.mockResolvedValue(ratingDetail({ version: 4 }));
    await userEvent.click(drawer.getByRole("button", { name: "Count it again" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Count this rating again" }));
    await userEvent.type(dialog.getByLabelText(/^Reason/), "Was a mistake");
    await userEvent.click(dialog.getByRole("button", { name: "Count it again" }));
    await waitFor(() => expect(api.setRatingExcluded).toHaveBeenCalledWith(21, false, "Was a mistake", 2));
  });

  it("does not resend a refused version: STALE_VERSION shows the rating as read again", async () => {
    const drawer = within(await openDrawer());
    await userEvent.click(await drawer.findByRole("button", { name: "Leave it out of the averages" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Leave this rating out" }));
    await userEvent.type(dialog.getByLabelText(/^Reason/), "Customer away");
    api.setRatingExcluded.mockRejectedValueOnce(apiError(409, "STALE_VERSION")).mockResolvedValue(ratingDetail({ excluded: true, version: 6 }));
    api.fetchRating.mockResolvedValue(ratingDetail({ version: 5 }));
    await userEvent.click(dialog.getByRole("button", { name: "Leave it out" }));
    expect(await dialog.findByText("The rating changed meanwhile")).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByRole("button", { name: "Leave it out" })).toBeEnabled());
    await userEvent.click(dialog.getByRole("button", { name: "Leave it out" }));
    await waitFor(() => expect(api.setRatingExcluded).toHaveBeenCalledTimes(2));
    expect(api.setRatingExcluded.mock.calls.map((c) => c[3])).toEqual([2, 5]);
  });
});
