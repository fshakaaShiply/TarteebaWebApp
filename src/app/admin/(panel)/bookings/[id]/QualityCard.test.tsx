import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { BookingQuality } from "@/lib/admin/quality/types";
import { bookingDetail } from "@/test/bookingFixtures";
import { attachment, caseDetail } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { QualityCard } from "./QualityCard";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/bookings/4",
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ createCase: vi.fn(), uploadCaseFile: vi.fn() }));
vi.mock("@/lib/admin/quality/endpoints", () => api);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });
const quality = (over: Partial<BookingQuality> = {}): BookingQuality => ({
  rating: { id: 21, overall: 2, is_low: true },
  cases: [{ id: 7, reference: "TC-4XQ8NM", type: "complaint", status: "in_review", status_label: { ar: "قيد المراجعة", en: "In review" } }],
  ...over,
});
const renderCard = (q: BookingQuality | null | undefined, permissions: readonly string[] = ["bookings.view", "complaints.manage"]) =>
  renderWithProviders(<QualityCard booking={bookingDetail({ quality: q })} />, { permissions });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  push.mockReset();
});

describe("the booking's quality block", () => {
  it("shows the rating with a low flag and each case as a link to A10", () => {
    renderCard(quality());
    expect(screen.getByRole("img", { name: "2 out of 5" })).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TC-4XQ8NM" })).toHaveAttribute("href", "/admin/quality/7");
    expect(screen.getByText("In review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the rating" })).toHaveAttribute("href", "/admin/quality/ratings?q=TRB-R4RYSD");
  });

  it("says there is no rating and no case yet", () => {
    renderCard(quality({ rating: null, cases: [] }));
    expect(screen.getByText("The customer has not rated this visit.")).toBeInTheDocument();
    expect(screen.getByText("No cases on this booking.")).toBeInTheDocument();
  });

  it("shows only the rating to staff the API gives no case list (no complaints.manage), and no way to open a complaint", () => {
    renderCard(quality({ cases: null }), ["bookings.view"]);
    expect(screen.getByRole("img", { name: "2 out of 5" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cases" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open complaint" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open the rating" })).toBeNull();
  });

  it("is not shown when the API sends no block", () => {
    renderCard(undefined);
    expect(screen.queryByText("Quality")).toBeNull();
  });
});

describe("opening a complaint from the booking", () => {
  async function openDialog() {
    renderCard(quality({ rating: null, cases: [] }));
    await userEvent.click(screen.getByRole("button", { name: "Open complaint" }));
    return within(await screen.findByRole("dialog"));
  }

  it("logs what the customer said against this customer and booking, with a key, and opens the new case", async () => {
    const dialog = await openDialog();
    api.createCase.mockResolvedValue(caseDetail({ id: 31, reference: "TC-NEW001" }));
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "lateness");
    await userEvent.type(dialog.getByLabelText(/^What the customer said/), "The cleaners came two hours late.");
    await userEvent.selectOptions(dialog.getByLabelText(/^How did it reach you/), "whatsapp");
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    await waitFor(() => expect(api.createCase).toHaveBeenCalledTimes(1));
    expect(api.createCase).toHaveBeenCalledWith(
      {
        customer_id: "01m5dtszzdhx5gtmwvj7bmbvm9",
        booking_id: 4,
        type: "complaint",
        category: "lateness",
        description: "The cleaners came two hours late.",
        source: "whatsapp",
      },
      expect.stringMatching(UUID),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/quality/31"));
  });

  it("checks the form before it sends anything", async () => {
    const dialog = await openDialog();
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    expect(await dialog.findByText("Choose a category.")).toBeInTheDocument();
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "quality");
    await userEvent.type(dialog.getByLabelText(/^What the customer said/), "short");
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    expect(await dialog.findByText("This is too short.")).toBeInTheDocument();
    expect(api.createCase).not.toHaveBeenCalled();
  });

  it("asks why it is being logged late once the API says the window has closed, and sends the reason", async () => {
    const dialog = await openDialog();
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "quality");
    await userEvent.type(dialog.getByLabelText(/^What the customer said/), "The kitchen was left dirty last month.");
    api.createCase.mockRejectedValueOnce(apiError(422, "COMPLAINT_NOT_ALLOWED", { reason: "window_closed" })).mockResolvedValue(caseDetail({ id: 32 }));
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    expect(await dialog.findAllByText(/The time allowed for complaints on this visit has passed/)).not.toHaveLength(0);
    await userEvent.type(dialog.getByLabelText(/^Why now/), "Customer was abroad");
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    await waitFor(() => expect(api.createCase).toHaveBeenCalledTimes(2));
    expect(api.createCase.mock.calls[1][0]).toMatchObject({ window_override_reason: "Customer was abroad" });
    // A different body is a different intent: a new key.
    expect(api.createCase.mock.calls[1][1]).not.toBe(api.createCase.mock.calls[0][1]);
  });

  it("uploads the photos first and names them in the case", async () => {
    const dialog = await openDialog();
    api.uploadCaseFile.mockResolvedValue(attachment({ id: "UP9" }));
    api.createCase.mockResolvedValue(caseDetail({ id: 33 }));
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "damage");
    await userEvent.type(dialog.getByLabelText(/^What the customer said/), "A glass table was chipped.");
    await userEvent.upload(dialog.getByLabelText("Photos"), new File(["x"], "table.jpg", { type: "image/jpeg" }));
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    await waitFor(() => expect(api.createCase).toHaveBeenCalled());
    expect(api.uploadCaseFile).toHaveBeenCalledTimes(1);
    expect(api.createCase.mock.calls[0][0]).toMatchObject({ attachment_ids: ["UP9"] });
  });

  it("words the API's refusal: another open case holds that category", async () => {
    const dialog = await openDialog();
    api.createCase.mockRejectedValue(apiError(409, "COMPLAINT_ALREADY_OPEN", { reference: "TC-OLD001" }));
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "quality");
    await userEvent.type(dialog.getByLabelText(/^What the customer said/), "The kitchen was left dirty.");
    await userEvent.click(dialog.getByRole("button", { name: "Open complaint" }));
    expect(await dialog.findByText("Another open case already holds that category on this booking.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
