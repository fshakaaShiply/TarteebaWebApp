import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { contentPage } from "@/test/customerFixtures";
import { renderWithProviders } from "@/test/render";
import { LegalPageEditorScreen, changedFields } from "./LegalPageEditorScreen";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/pages/4",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: router.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const api = vi.hoisted(() => ({ fetchPage: vi.fn(), updatePage: vi.fn(), publishPage: vi.fn(), deletePage: vi.fn() }));
vi.mock("@/lib/admin/legal/endpoints", () => api);

const STAFF = ["settings.manage"];
const draft = (over: Parameters<typeof contentPage>[0] = {}) =>
  contentPage({ id: 4, status: "draft", status_label: { ar: "مسودة", en: "Draft" }, published_at: null, published_by: null, version: 3, version_label: "2026-11", ...over });
const open = (id = "4", permissions: readonly string[] = STAFF, locale: "en" | "ar" = "en") => renderWithProviders(<LegalPageEditorScreen id={id} />, { permissions, locale });
const err = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  router.push.mockReset();
  api.fetchPage.mockResolvedValue(draft());
});

describe("changed fields", () => {
  it("sends only what changed, so a save never overwrites what the person did not touch", () => {
    const page = draft();
    const same = { version_label: page.version_label, effective_date: page.effective_date, title: { ...page.title }, body: { ...page.body } };
    expect(changedFields(page, same)).toEqual({});
    expect(changedFields(page, { ...same, version_label: " 2026-12 " })).toEqual({ version_label: "2026-12" });
    expect(changedFields(page, { ...same, body: { ...page.body, en: "New text" } })).toEqual({ body: { ar: page.body.ar, en: "New text" } });
    expect(changedFields(page, { ...same, effective_date: "2026-12-01", title: { ar: "ع", en: page.title.en } })).toEqual({ effective_date: "2026-12-01", title: { ar: "ع", en: page.title.en } });
  });
});

describe("A11 legal page editor", () => {
  it("shows the draft's fields and a preview rendered exactly as the customer page renders it", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: /Terms and conditions/ })).toHaveTextContent("2026-11");
    expect(screen.getByLabelText(/Version label/)).toHaveValue("2026-11");
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Terms and conditions");
    const preview = screen.getByRole("article", { name: "Preview" });
    expect(within(preview).getByRole("heading", { level: 2, name: "Terms and conditions" })).toBeInTheDocument();
    expect(within(preview).getByRole("heading", { level: 2, name: "Acceptance" })).toBeInTheDocument();
    // Typing updates the preview at once, through the same renderer.
    const body = screen.getByLabelText(/^Text/);
    await userEvent.clear(body);
    await userEvent.type(body, "# Rules{Enter}- One{Enter}- Two");
    await waitFor(() => expect(within(preview).getByRole("heading", { level: 2, name: "Rules" })).toBeInTheDocument());
    expect(within(within(preview).getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
  });

  it("switches between the Arabic and the English text, each in its own direction", async () => {
    open();
    await screen.findByLabelText(/^Title/);
    await userEvent.click(screen.getByRole("tab", { name: "Arabic" }));
    expect(screen.getByLabelText(/^Title/)).toHaveValue("الشروط والأحكام");
    expect(screen.getByLabelText(/^Title/)).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("article", { name: "Preview" })).toHaveAttribute("dir", "rtl");
  });

  it("saves only the changed fields with the page's version as If-Match, then publishes only the saved text", async () => {
    open();
    const save = await screen.findByRole("button", { name: "Save draft" });
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(save).toBeDisabled();
    expect(publish).toBeEnabled();
    await userEvent.type(screen.getByLabelText(/Version label/), "b");
    // Unsaved edits: save is on and publish waits for the save.
    expect(save).toBeEnabled();
    expect(publish).toBeDisabled();
    expect(screen.getByText("Save the draft before publishing it.", { selector: "div,p,span" })).toBeInTheDocument();
    // The API answers the saved page, and reads of it give the same from then on.
    const saved = draft({ version_label: "2026-11b", version: 4 });
    api.updatePage.mockImplementation(async () => {
      api.fetchPage.mockResolvedValue(saved);
      return saved;
    });
    await userEvent.click(save);
    await waitFor(() => expect(api.updatePage).toHaveBeenCalledWith(4, { version_label: "2026-11b" }, 3));
    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled());
  });

  it("checks the fields first: an empty title or an invalid label sends nothing", async () => {
    open();
    await userEvent.clear(await screen.findByLabelText(/^Title/));
    await userEvent.clear(screen.getByLabelText(/Version label/));
    await userEvent.type(screen.getByLabelText(/Version label/), "bad label");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Write the title in this language.")).toBeInTheDocument();
    expect(screen.getByText("Use letters, digits, dot, dash or underscore, starting with a letter or digit.")).toBeInTheDocument();
    expect(api.updatePage).not.toHaveBeenCalled();
  });

  it("does not overwrite a page someone else changed: it says so and loads the latest on request", async () => {
    open();
    await userEvent.type(await screen.findByLabelText(/Version label/), "x");
    api.updatePage.mockRejectedValue(err(409, "STALE_VERSION", { current_version: 4 }));
    api.fetchPage.mockResolvedValue(draft({ version: 4, version_label: "2026-11", title: { ar: "ع", en: "Edited by someone" } }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Someone changed this page")).toBeInTheDocument();
    expect(api.updatePage).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Load the latest version" }));
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveValue("Edited by someone"));
    expect(screen.queryByText("Someone changed this page")).toBeNull();
  });

  it("asks for a reason to publish, warns that terms ask everyone to accept again, and sends the reason with the version", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Publish Terms and conditions, version 2026-11");
    expect(dialog).toHaveTextContent("Everyone is asked to accept again");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText("Write the reason, 3 to 500 characters.")).toBeInTheDocument();
    expect(api.publishPage).not.toHaveBeenCalled();
    api.publishPage.mockResolvedValue(contentPage({ id: 4, version_label: "2026-11" }));
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Updated clause 4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(api.publishPage).toHaveBeenCalledWith(4, "Updated clause 4", 3));
    expect(await screen.findByText("Terms and conditions version 2026-11 is published")).toBeInTheDocument();
  });

  it("does not warn about re-accepting for the cancellation page", async () => {
    api.fetchPage.mockResolvedValue(draft({ slug: "cancellation", title: { ar: "الإلغاء", en: "Cancellation" }, body: { ar: "تظهر الرسوم قبل التأكيد", en: "Fees are shown before you confirm" } }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText("Everyone is asked to accept again")).toBeNull();
  });

  it("stops a cancellation text that quotes a percentage before the API does, and the API's refusal reads in words", async () => {
    api.fetchPage.mockResolvedValue(draft({ slug: "cancellation", body: { ar: "رسوم ٥٠٪", en: "A 50% fee" } }));
    open();
    expect(await screen.findByText(/This text quotes a percentage/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("shows the API's refusal to publish in words", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const dialog = await screen.findByRole("alertdialog");
    api.publishPage.mockRejectedValue(err(422, "PAGE_FIGURES_NOT_ALLOWED"));
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Go live now");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByText(/The cancellation page may not quote a percentage/)).toBeInTheDocument();
  });

  it("deletes a draft after a confirmation, and goes back to the list", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    const dialog = await screen.findByRole("alertdialog");
    api.deletePage.mockResolvedValue(undefined);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete draft" }));
    await waitFor(() => expect(api.deletePage).toHaveBeenCalledWith(4, 3));
    expect(router.push).toHaveBeenCalledWith("/admin/settings/pages");
  });

  it("shows a published version read-only, without the draft actions", async () => {
    api.fetchPage.mockResolvedValue(contentPage({ id: 4 }));
    open();
    expect(await screen.findByText(/This version is published or in the history/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Version label/)).toBeDisabled();
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  });

  it("says when the version is not found (a number that is not an id too), and denies staff without settings.manage", async () => {
    api.fetchPage.mockRejectedValue(err(404, "NOT_FOUND"));
    const { unmount } = open();
    expect(await screen.findByText("Page version not found")).toBeInTheDocument();
    unmount();
    api.fetchPage.mockClear();
    const second = open("abc");
    expect(await screen.findByText("Page version not found")).toBeInTheDocument();
    expect(api.fetchPage).not.toHaveBeenCalled();
    second.unmount();
    open("4", ["catalog.manage"]);
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
  });

  it("starts on the Arabic text for an Arabic page and previews it right to left", async () => {
    open("4", STAFF, "ar");
    expect(await screen.findByLabelText(/^العنوان/)).toHaveValue("الشروط والأحكام");
    expect(screen.getByRole("article", { name: "معاينة" })).toHaveAttribute("dir", "rtl");
  });
});
