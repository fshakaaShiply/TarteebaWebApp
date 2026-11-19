import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { contentPage } from "@/test/customerFixtures";
import { renderWithProviders } from "@/test/render";
import { LegalPagesScreen } from "./LegalPagesScreen";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/settings/pages",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: router.push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const api = vi.hoisted(() => ({ fetchPages: vi.fn(), createPage: vi.fn() }));
vi.mock("@/lib/admin/legal/endpoints", () => api);

const STAFF = ["settings.manage"];
const privacyPublished = contentPage({ id: 2, slug: "privacy", version_label: "2026-09", title: { ar: "سياسة الخصوصية", en: "Privacy policy" }, published_by: { id: 3, name: "Huda" } });
const cancellation = contentPage({ id: 3, slug: "cancellation", version_label: "2026-10", title: { ar: "سياسة الإلغاء", en: "Cancellation policy" } });
const termsDraft = contentPage({ id: 4, version_label: "2026-11", status: "draft", status_label: { ar: "مسودة", en: "Draft" }, published_at: null, published_by: null, effective_date: "2026-11-15", version: 1 });
const termsOld = contentPage({ id: 5, version_label: "2026-04", status: "superseded", status_label: { ar: "سابق", en: "Superseded" }, effective_date: "2026-04-01", version: 3 });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  router.push.mockReset();
  api.fetchPages.mockResolvedValue([contentPage(), privacyPublished, cancellation, termsDraft, termsOld]);
});

describe("A11 legal pages", () => {
  it("shows, for each page, the version customers read, the drafts and the history", async () => {
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF });
    const terms = (await screen.findByRole("heading", { name: "Terms and conditions" })).closest("section")!;
    const published = within(terms).getByRole("region", { name: "Published" });
    expect(published).toHaveTextContent("Version 2026-10");
    expect(published).toHaveTextContent("Published");
    expect(published).toHaveTextContent("Effective Thu, 1 Oct 2026");
    expect(published).toHaveTextContent("by Omar");
    const drafts = within(terms).getByRole("region", { name: "Drafts" });
    expect(drafts).toHaveTextContent("Version 2026-11");
    expect(within(drafts).getByRole("link", { name: "Edit version 2026-11" })).toHaveAttribute("href", "/admin/settings/pages/4");
    // The history is collapsed; its rows open read-only.
    expect(within(terms).getByText("Earlier versions (1)")).toBeInTheDocument();
    expect(within(terms).getByRole("link", { name: "Open version 2026-04" })).toHaveAttribute("href", "/admin/settings/pages/5");
    expect(within(terms).getByText(/Customers accept each new version/)).toBeInTheDocument();
    const privacy = screen.getByRole("heading", { name: "Privacy policy" }).closest("section")!;
    expect(within(privacy).getByText("No draft is being written.")).toBeInTheDocument();
    expect(within(privacy).getByRole("link", { name: "View as customers see it" })).toHaveAttribute("href", "/policies/privacy?lang=en");
    // The cancellation page says it quotes no figure.
    expect(within(screen.getByRole("heading", { name: "Cancellation and refund policy" }).closest("section")!).getByText(/Quote no fee, percentage or number of hours/)).toBeInTheDocument();
  });

  it("warns when nothing is published", async () => {
    api.fetchPages.mockResolvedValue([termsDraft]);
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF });
    const warnings = await screen.findAllByText("Nothing is published yet: customers cannot read this page.");
    expect(warnings).toHaveLength(3);
  });

  it("starts a new version as a copy of the published text and opens its editor", async () => {
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "New version of Terms and conditions" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("It starts as a copy of version 2026-10.");
    // A label that is not valid is refused on the page.
    await userEvent.click(within(dialog).getByRole("button", { name: "Create draft" }));
    expect(await within(dialog).findByText("Write the version label.")).toBeInTheDocument();
    expect(api.createPage).not.toHaveBeenCalled();
    api.createPage.mockResolvedValue(contentPage({ id: 9, status: "draft", version_label: "2026-12" }));
    await userEvent.type(within(dialog).getByLabelText(/Version label/), "2026-12");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create draft" }));
    await waitFor(() =>
      expect(api.createPage).toHaveBeenCalledWith({
        slug: "terms",
        version_label: "2026-12",
        effective_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        title: { ar: "الشروط والأحكام", en: "Terms and conditions" },
        body: contentPage().body,
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/admin/settings/pages/9");
  });

  it("says when the label is taken", async () => {
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "New version of Privacy policy" }));
    const dialog = await screen.findByRole("dialog");
    api.createPage.mockRejectedValue(new AdminApiError(422, { code: "VERSION_LABEL_TAKEN", message: "", details: { version_label: "2026-09" } }));
    await userEvent.type(within(dialog).getByLabelText(/Version label/), "2026-09");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create draft" }));
    expect(await within(dialog).findByText("Version 2026-09 already exists for this page. Choose another label.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("is denied without settings.manage, and shows a failed load with a retry", async () => {
    const { unmount } = renderWithProviders(<LegalPagesScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
    expect(api.fetchPages).not.toHaveBeenCalled();
    unmount();
    api.fetchPages.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF });
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Terms and conditions" })).toBeInTheDocument();
  });

  it("speaks Arabic and links the public page in Arabic", async () => {
    renderWithProviders(<LegalPagesScreen />, { permissions: STAFF, locale: "ar" });
    const terms = (await screen.findByRole("heading", { name: "الشروط والأحكام" })).closest("section")!;
    expect(within(terms).getByRole("link", { name: "عرضها كما يراها العملاء" })).toHaveAttribute("href", "/policies/terms?lang=ar");
    expect(within(terms).getByText("الإصدارات السابقة (1)")).toBeInTheDocument();
  });
});
