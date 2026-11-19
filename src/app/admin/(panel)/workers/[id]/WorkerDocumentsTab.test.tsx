import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { formatIsoDate } from "@/lib/admin/format";
import { document, worker } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { WorkerDocumentsTab } from "./WorkerDocumentsTab";

const api = {
  fetchWorkerDocuments: vi.fn(),
  createWorkerDocument: vi.fn(),
  updateWorkerDocument: vi.fn(),
  replaceDocumentFile: vi.fn(),
  deleteWorkerDocument: vi.fn(),
  fetchDocumentFile: vi.fn(),
};
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchWorkerDocuments: (...a: unknown[]) => api.fetchWorkerDocuments(...a),
  createWorkerDocument: (...a: unknown[]) => api.createWorkerDocument(...a),
  updateWorkerDocument: (...a: unknown[]) => api.updateWorkerDocument(...a),
  replaceDocumentFile: (...a: unknown[]) => api.replaceDocumentFile(...a),
  deleteWorkerDocument: (...a: unknown[]) => api.deleteWorkerDocument(...a),
  fetchDocumentFile: (...a: unknown[]) => api.fetchDocumentFile(...a),
}));

const HR = ["workers.view", "workers.documents"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const open = (locale: "en" | "ar" = "en") => renderWithProviders(<WorkerDocumentsTab worker={worker()} />, { permissions: HR, locale });
const pdf = () => new File(["%PDF"], "visa.pdf", { type: "application/pdf" });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
  api.fetchWorkerDocuments.mockResolvedValue([document()]);
});

describe("A05 documents tab (workforce §5.1)", () => {
  it("lists a document with its number's last characters only, its dates, and the days left in its chip", async () => {
    api.fetchWorkerDocuments.mockResolvedValue([
      document(),
      document({ id: 8, type: "passport", type_label: { ar: "جواز السفر", en: "Passport" }, number_last4: "4821", expires_at: "2026-09-01", state: "expired", days_left: null }),
      document({ id: 9, type: "other", title: "Insurance card", type_label: { ar: "وثيقة أخرى", en: "Other document" }, number_last4: "", expires_at: null, state: "no_expiry", days_left: null, file: null }),
    ]);
    open();
    await screen.findByText("Insurance card");
    const rows = within(screen.getByRole("table", { name: "Documents of the cleaner" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Residency visa");
    expect(rows[1]).toHaveTextContent("•••• 67-1");
    expect(rows[1]).toHaveTextContent("Expires in 21 days");
    expect(rows[1]).toHaveTextContent(formatIsoDate("2026-11-13", "en", "short"));
    expect(rows[2]).toHaveTextContent("•••• 4821");
    expect(rows[2]).toHaveTextContent("Expired");
    // An `other` document is named by its own title, and a missing file says so.
    expect(rows[3]).toHaveTextContent("Insurance card");
    expect(rows[3]).toHaveTextContent("No file");
    expect(rows[3]).toHaveTextContent("No expiry");
    expect(screen.queryByText("784-1999-1234567-1")).not.toBeInTheDocument();
  });

  it("says a document expires today on the day itself, in Arabic too", async () => {
    api.fetchWorkerDocuments.mockResolvedValue([document({ days_left: 0 })]);
    const { unmount } = open();
    expect(await screen.findByText("Expires today")).toBeInTheDocument();
    unmount();
    open("ar");
    expect(await screen.findByText("تنتهي اليوم")).toBeInTheDocument();
  });

  it("shows the archived documents only on request, as another read with include_archived", async () => {
    api.fetchWorkerDocuments.mockResolvedValueOnce([document()]).mockResolvedValue([document(), document({ id: 5, archived_at: "2026-10-01T00:00:00+00:00", superseded_by_id: 7, state: "valid" })]);
    open();
    const user = userEvent.setup();
    await screen.findByRole("table");
    expect(api.fetchWorkerDocuments).toHaveBeenLastCalledWith(3, false);
    await user.click(screen.getByRole("checkbox", { name: "Show archived documents" }));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(api.fetchWorkerDocuments).toHaveBeenLastCalledWith(3, true);
  });

  it("has an empty state and a retry on error", async () => {
    api.fetchWorkerDocuments.mockResolvedValueOnce([]);
    const { unmount } = open();
    expect(await screen.findByText("No documents yet")).toBeInTheDocument();
    unmount();
    api.fetchWorkerDocuments.mockRejectedValueOnce(apiError(500, "SERVER_ERROR")).mockResolvedValueOnce([document()]);
    open();
    await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/i }));
    expect(await screen.findByText("Residency visa")).toBeInTheDocument();
  });

  it("adds a document with its file: checks the form first, then sends the fields and the file", async () => {
    api.createWorkerDocument.mockResolvedValue(document({ id: 10 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add document" }));
    const dialog = screen.getByRole("dialog", { name: "Add a document" });
    await user.click(within(dialog).getByRole("button", { name: "Add document" }));
    expect(within(dialog).getByText("Choose the type of document.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose the file of the document.")).toBeInTheDocument();
    expect(api.createWorkerDocument).not.toHaveBeenCalled();

    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Type/ }), "residency");
    await user.type(within(dialog).getByLabelText("Number"), "784-1999-1234567-1");
    await user.type(within(dialog).getByLabelText("Expires on"), "2027-11-13");
    await user.upload(within(dialog).getByLabelText(/File \(the scan\)/), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Add document" }));
    await waitFor(() => expect(api.createWorkerDocument).toHaveBeenCalledTimes(1));
    const [workerId, fields, file, supersedes] = api.createWorkerDocument.mock.calls[0];
    expect(workerId).toBe(3);
    expect(fields).toMatchObject({ type: "residency", number: "784-1999-1234567-1", expires_at: "2027-11-13", title: null, issued_at: null });
    expect((file as File).name).toBe("visa.pdf");
    expect(supersedes).toBeNull();
    expect(await screen.findByText("Document added.")).toBeInTheDocument();
  });

  it("asks for a title when the type is other, and shows the API's field message in the language", async () => {
    api.createWorkerDocument.mockRejectedValue(apiError(422, "VALIDATION_FAILED", { fields: { expires_at: ["The expiry date must be after or equal to the issue date."] } }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add document" }));
    const dialog = screen.getByRole("dialog", { name: "Add a document" });
    await user.selectOptions(within(dialog).getByRole("combobox", { name: /Type/ }), "other");
    await user.upload(within(dialog).getByLabelText(/File \(the scan\)/), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Add document" }));
    expect(within(dialog).getByText("Give the document a title.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: /^Title/ }), "Insurance card");
    await user.click(within(dialog).getByRole("button", { name: "Add document" }));
    expect(await within(dialog).findByText("The expiry date must be after or equal to the issue date.")).toBeInTheDocument();
  });

  it("renews from the row: starts from its type and sends the old document's id as supersedes_id", async () => {
    api.createWorkerDocument.mockResolvedValue(document({ id: 11, supersedes_id: 7 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Renew Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Renew Residency visa" });
    expect(within(dialog).getByRole("combobox", { name: /Type/ })).toHaveValue("residency");
    expect(within(dialog).getByLabelText("Alert before expiry (days)")).toHaveValue("30");
    await user.type(within(dialog).getByLabelText("Expires on"), "2028-11-13");
    await user.upload(within(dialog).getByLabelText(/File \(the scan\)/), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Renew document" }));
    await waitFor(() => expect(api.createWorkerDocument).toHaveBeenCalledTimes(1));
    expect(api.createWorkerDocument.mock.calls[0][1]).toMatchObject({ type: "residency", expires_at: "2028-11-13", alert_days_before: 30 });
    expect(api.createWorkerDocument.mock.calls[0][3]).toBe(7);
    expect(await screen.findByText("Document renewed.")).toBeInTheDocument();
  });

  it("edits only what changed, with the document's version, and never offers the stored number", async () => {
    api.updateWorkerDocument.mockResolvedValue(document({ version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Residency visa" });
    expect(within(dialog).getByLabelText("Number")).toHaveValue("");
    expect(within(dialog).getByText(/Stored number: .*67-1.*\. Leave empty to keep it\./)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Expires on"));
    await user.type(within(dialog).getByLabelText("Expires on"), "2027-11-13");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateWorkerDocument).toHaveBeenCalledWith(7, { expires_at: "2027-11-13" }, 1));
    expect(await screen.findByText("Document saved.")).toBeInTheDocument();
  });

  it("clears the number only when asked", async () => {
    api.updateWorkerDocument.mockResolvedValue(document({ version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Residency visa" });
    await user.click(within(dialog).getByRole("checkbox", { name: "Remove the number" }));
    expect(within(dialog).getByLabelText("Number")).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateWorkerDocument).toHaveBeenCalledWith(7, { number: null }, 1));
  });

  it("after a 409 STALE_VERSION shows what is saved now, keeps what was typed and sends the new version, never the refused one", async () => {
    api.updateWorkerDocument.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 2 })).mockResolvedValueOnce(document({ version: 3 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Residency visa" });
    await user.type(within(dialog).getByLabelText("Notes"), "Scan is clear");
    api.fetchWorkerDocuments.mockResolvedValue([document({ version: 2, expires_at: "2026-12-31" })]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/This document changed while you were working\. Check what is saved now/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("Scan is clear");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateWorkerDocument).toHaveBeenCalledTimes(2));
    expect(api.updateWorkerDocument.mock.calls.map((c) => c[2])).toEqual([1, 2]);
  });

  it("says so when the document was deleted meanwhile, and can no longer be saved", async () => {
    api.updateWorkerDocument.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Residency visa" });
    await user.type(within(dialog).getByLabelText("Notes"), "x");
    api.fetchWorkerDocuments.mockResolvedValue([]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("This document no longer exists. Someone else deleted it.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("edits only the notes of an archived document", async () => {
    api.fetchWorkerDocuments.mockResolvedValue([document({ id: 5, archived_at: "2026-10-01T00:00:00+00:00", superseded_by_id: 7, state: "valid" })]);
    api.updateWorkerDocument.mockResolvedValue(document({ id: 5 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Residency visa" });
    expect(within(dialog).getByText("This document was renewed. Only its notes can change.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Expires on")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Renew Residency visa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace the file of Residency visa" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Notes"), "old scan");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateWorkerDocument).toHaveBeenCalledWith(5, { notes: "old scan" }, 1));
  });

  it("replaces the file with the document's version", async () => {
    api.replaceDocumentFile.mockResolvedValue(document({ version: 2 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Replace the file of Residency visa" }));
    const dialog = screen.getByRole("dialog", { name: "Replace the file of Residency visa" });
    await user.click(within(dialog).getByRole("button", { name: "Replace file" }));
    expect(within(dialog).getByText("Choose the file of the document.")).toBeInTheDocument();
    await user.upload(within(dialog).getByLabelText(/File \(the scan\)/), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Replace file" }));
    await waitFor(() => expect(api.replaceDocumentFile).toHaveBeenCalledTimes(1));
    expect(api.replaceDocumentFile.mock.calls[0][0]).toBe(7);
    expect(api.replaceDocumentFile.mock.calls[0][2]).toBe(1);
    expect(await screen.findByText("File replaced.")).toBeInTheDocument();
  });

  it("confirms a delete naming that the file is removed for good, then deletes with the version", async () => {
    api.deleteWorkerDocument.mockResolvedValue(undefined);
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Residency visa" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Residency visa?" });
    expect(dialog).toHaveTextContent("The stored file is deleted for good.");
    expect(api.deleteWorkerDocument).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteWorkerDocument).toHaveBeenCalledWith(7, 1));
    expect(await screen.findByText("Document deleted.")).toBeInTheDocument();
  });

  it("says deleting a renewal brings the earlier document back", async () => {
    api.fetchWorkerDocuments.mockResolvedValue([document({ supersedes_id: 5 })]);
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete Residency visa" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("brings the earlier document back as the current one");
  });

  it("opens the file through a fresh signed link, asked for on click", async () => {
    api.fetchDocumentFile.mockResolvedValue({ url: "https://files.test/signed?x=1", expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), file_name: "visa.pdf" });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Open file/ }));
    expect(api.fetchDocumentFile).toHaveBeenCalledWith(7);
    const link = await screen.findByRole("link", { name: /Open/ });
    expect(link).toHaveAttribute("href", "https://files.test/signed?x=1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("is written in Arabic with a masked number kept left to right", async () => {
    open("ar");
    await screen.findByText("تأشيرة الإقامة");
    const row = within(screen.getByRole("table", { name: "وثائق العاملة" })).getAllByRole("row")[1];
    expect(row).toHaveTextContent("تأشيرة الإقامة");
    expect(row.querySelector('bdi[dir="ltr"]')).toHaveTextContent("•••• 67-1");
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
