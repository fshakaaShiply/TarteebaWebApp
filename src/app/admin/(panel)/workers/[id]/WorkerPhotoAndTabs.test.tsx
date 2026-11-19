import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { renderWithProviders } from "@/test/render";
import { attendanceDay, document as workerDocument, stats, worker } from "@/test/workforceFixtures";
import { WorkerDetailScreen } from "./WorkerDetailScreen";
import { WorkerPhotoCard } from "./WorkerPhotoCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/workers/3",
}));

const api = {
  fetchWorker: vi.fn(),
  uploadWorkerPhoto: vi.fn(),
  deleteWorkerPhoto: vi.fn(),
  fetchWorkerDocuments: vi.fn(),
  fetchWorkerAttendance: vi.fn(),
  fetchWorkerStats: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchWorker: (...a: unknown[]) => api.fetchWorker(...a),
  fetchZoneOptions: async () => [{ id: 1, code: "DEMO_BB", name: { ar: "الخليج التجاري", en: "Business Bay" }, is_active: true }],
  fetchServiceOptions: async () => [],
}));
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  uploadWorkerPhoto: (...a: unknown[]) => api.uploadWorkerPhoto(...a),
  deleteWorkerPhoto: (...a: unknown[]) => api.deleteWorkerPhoto(...a),
  fetchWorkerDocuments: (...a: unknown[]) => api.fetchWorkerDocuments(...a),
  fetchWorkerAttendance: (...a: unknown[]) => api.fetchWorkerAttendance(...a),
  fetchWorkerStats: (...a: unknown[]) => api.fetchWorkerStats(...a),
}));

const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const jpeg = () => new File(["x"], "me.jpg", { type: "image/jpeg" });
const withPhoto = worker({ photo_url: "https://files.test/p.jpg", photo: { url: "https://files.test/p.jpg", approved_at: "2026-10-01T08:00:00+00:00", approved_by: { id: 4, name: "Huda HR" } } });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  api.fetchWorker.mockResolvedValue(worker());
  api.fetchWorkerDocuments.mockResolvedValue([workerDocument()]);
  api.fetchWorkerAttendance.mockResolvedValue({ data: [attendanceDay()], meta: { month: "2026-10", summary: { expected_days: 1, present_days: 0, absent_days: 0, late_days: 0, half_days: 0, unrecorded_days: 1, leave_days: 0 }, locked: false, proposal: null } });
  api.fetchWorkerStats.mockResolvedValue(stats({ incentive: null }));
});

describe("A05 photo card (workforce §3.5)", () => {
  it("shows the approved photo and who approved it, and the note about what customers see", () => {
    renderWithProviders(<WorkerPhotoCard worker={withPhoto} />, { permissions: ["workers.view"] });
    expect(screen.getByText("Approved for customers by Huda HR.")).toBeInTheDocument();
    expect(window.document.querySelector("img")).toHaveAttribute("src", "https://files.test/p.jpg");
    expect(screen.getByText(/Customers see her name and her approved photo only\. Documents are visible to HR and the system administrator\./)).toBeInTheDocument();
    // Read only: no way to change it.
    expect(screen.queryByRole("button", { name: "Upload photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });

  it("uploads only with the approval ticked, sending the worker's version, and says it was saved", async () => {
    api.uploadWorkerPhoto.mockResolvedValue(withPhoto);
    renderWithProviders(<WorkerPhotoCard worker={worker()} />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();
    expect(screen.getByText("No photo yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeDisabled();
    await user.upload(screen.getByLabelText("Upload a photo"), jpeg());
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByText("Tick “Approved for customers” to upload the photo.")).toBeInTheDocument();
    expect(api.uploadWorkerPhoto).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /Approved for customers/ }));
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() => expect(api.uploadWorkerPhoto).toHaveBeenCalledTimes(1));
    expect(api.uploadWorkerPhoto.mock.calls[0][0]).toBe(3);
    expect((api.uploadWorkerPhoto.mock.calls[0][1] as File).name).toBe("me.jpg");
    expect(api.uploadWorkerPhoto.mock.calls[0][2]).toBe(4);
    expect(await screen.findByText("Photo saved.")).toBeInTheDocument();
  });

  it("turns away a file that is not a JPEG, PNG or WebP, or is over 2 MB, before sending", async () => {
    renderWithProviders(<WorkerPhotoCard worker={worker()} />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(screen.getByLabelText("Upload a photo"), new File(["x"], "me.heic", { type: "image/heic" }));
    expect(await screen.findByText(/me\.heic/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeDisabled();
    await user.upload(screen.getByLabelText("Upload a photo"), new File([new Uint8Array(3 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText(/big\.jpg/)).toBeInTheDocument();
    expect(api.uploadWorkerPhoto).not.toHaveBeenCalled();
  });

  it("shows the API's PHOTO_INVALID in words, and reads the worker again after a 409 STALE_VERSION", async () => {
    api.uploadWorkerPhoto.mockRejectedValueOnce(apiError(422, "PHOTO_INVALID")).mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 5 }));
    renderWithProviders(<WorkerPhotoCard worker={worker()} />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Upload a photo"), jpeg());
    await user.click(screen.getByRole("checkbox", { name: /Approved for customers/ }));
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByText("The photo could not be read. Upload a JPEG, PNG or WebP image.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() => expect(api.fetchWorker).toHaveBeenCalledWith(3));
  });

  it("removes the photo after a confirmation, with the worker's version", async () => {
    api.deleteWorkerPhoto.mockResolvedValue(worker({ version: 5 }));
    renderWithProviders(<WorkerPhotoCard worker={withPhoto} />, { permissions: ["workers.view", "workers.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove Maria S.'s photo?" });
    expect(api.deleteWorkerPhoto).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(api.deleteWorkerPhoto).toHaveBeenCalledWith(3, 4));
    expect(await screen.findByText("Photo removed.")).toBeInTheDocument();
  });

  it("says NO_PHOTO when there was nothing to remove", async () => {
    api.deleteWorkerPhoto.mockRejectedValue(apiError(409, "NO_PHOTO", { worker_id: 3 }));
    renderWithProviders(<WorkerPhotoCard worker={withPhoto} />, { permissions: ["workers.manage"] });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove photo" }));
    expect(await within(screen.getByRole("alertdialog")).findByText("This cleaner has no photo to remove.")).toBeInTheDocument();
  });
});

describe("A05 profile tabs by permission (P5-W41)", () => {
  const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);

  it("offers attendance, documents and performance only to those who hold what each needs", async () => {
    const { unmount } = renderWithProviders(<WorkerDetailScreen id="3" />, { permissions: ["workers.view"] });
    await screen.findByRole("heading", { level: 1, name: "Maria S." });
    expect(tabNames()).toEqual(["Info", "Schedule", "Services & skills", "Leave", "Performance & incentives"]);
    unmount();

    renderWithProviders(<WorkerDetailScreen id="3" />, { permissions: ["workers.view", "attendance.manage", "workers.documents"] });
    await screen.findByRole("heading", { level: 1, name: "Maria S." });
    expect(tabNames()).toEqual(["Info", "Schedule", "Services & skills", "Leave", "Attendance", "Documents", "Performance & incentives"]);
  });

  it("opens the Documents tab from a link (?tab=documents), and falls back to Info when the tab is not the user's", async () => {
    const { unmount } = renderWithProviders(<WorkerDetailScreen id="3" initialTab="documents" />, { permissions: ["workers.view", "workers.documents"] });
    expect(await screen.findByRole("tab", { name: "Documents", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Residency visa")).toBeInTheDocument();
    unmount();
    api.fetchWorkerDocuments.mockClear();
    renderWithProviders(<WorkerDetailScreen id="3" initialTab="documents" />, { permissions: ["workers.view"] });
    expect(await screen.findByRole("tab", { name: "Info", selected: true })).toBeInTheDocument();
    expect(api.fetchWorkerDocuments).not.toHaveBeenCalled();
  });

  it("shows the photo card on the Info tab, above the profile form", async () => {
    api.fetchWorker.mockResolvedValue(withPhoto);
    renderWithProviders(<WorkerDetailScreen id="3" />, { permissions: ["workers.view", "workers.manage"] });
    expect(await screen.findByText("Approved for customers by Huda HR.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Photo" })).toBeInTheDocument();
  });

  it("loads the attendance and performance tabs only when they are opened", async () => {
    renderWithProviders(<WorkerDetailScreen id="3" />, { permissions: ["workers.view", "attendance.manage"] });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 1, name: "Maria S." });
    expect(api.fetchWorkerAttendance).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Attendance" }));
    await waitFor(() => expect(api.fetchWorkerAttendance).toHaveBeenCalledWith(3, "2026-10"));
    expect(api.fetchWorkerStats).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Performance & incentives" }));
    await waitFor(() => expect(api.fetchWorkerStats).toHaveBeenCalledWith(3, "2026-10-01", "2026-10-23"));
  });
});
