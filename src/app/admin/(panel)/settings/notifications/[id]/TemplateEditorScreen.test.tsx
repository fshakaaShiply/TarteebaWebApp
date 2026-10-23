import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { NotificationTemplate, TemplatePreview } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { TemplateEditorScreen } from "./TemplateEditorScreen";

const api = {
  fetchNotificationTemplate: vi.fn(),
  fetchNotificationTemplates: vi.fn(),
  previewNotificationTemplate: vi.fn(),
  updateNotificationTemplate: vi.fn(),
};
vi.mock("@/lib/admin/endpoints", () => ({
  fetchNotificationTemplate: (...a: unknown[]) => api.fetchNotificationTemplate(...a),
  fetchNotificationTemplates: (...a: unknown[]) => api.fetchNotificationTemplates(...a),
  previewNotificationTemplate: (...a: unknown[]) => api.previewNotificationTemplate(...a),
  updateNotificationTemplate: (...a: unknown[]) => api.updateNotificationTemplate(...a),
}));

// GET /admin/notification-templates/18 (booking.alternative_proposed, in-app, English) from the local API.
const template = (over: Partial<NotificationTemplate> = {}): NotificationTemplate => ({
  id: 18,
  event_key: "booking.alternative_proposed",
  event_label: "Other times suggested",
  group: "bookings",
  audience: "customer",
  channel: "in_app",
  channel_label: "In-app inbox",
  locale: "en",
  subject: "Other times suggested",
  body: "Choose one before  please.",
  is_active: true,
  version: 4,
  placeholders: [
    { name: "reference", token: "{{reference}}", description: "Booking reference (TRB-…)" },
    { name: "expires_at", token: "{{expires_at}}", description: "When the suggested times expire" },
  ],
  updated_by: null,
  updated_at: "2026-10-23T14:35:18+00:00",
  ...over,
});

const preview = (over: Partial<TemplatePreview> = {}): TemplatePreview => ({
  ar: { subject: "اقترحنا مواعيد بديلة", body: "يُرجى اختيار أحدها قبل الثلاثاء 3 نوفمبر، 18:00." },
  en: { subject: "Other times suggested", body: "Choose one before Tuesday 3 November, 18:00 please." },
  placeholders: ["reference", "expires_at"],
  unknown: [],
  ...over,
});

const consoleError = vi.spyOn(console, "error");

async function open() {
  const user = userEvent.setup();
  renderWithProviders(<TemplateEditorScreen id="18" />, { permissions: ["settings.manage"] });
  const body = (await screen.findByLabelText(/^Text/)) as HTMLTextAreaElement;
  return { user, body };
}

describe("TemplateEditorScreen", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    consoleError.mockClear();
    api.fetchNotificationTemplate.mockResolvedValue(template());
    api.fetchNotificationTemplates.mockResolvedValue([template(), template({ id: 17, locale: "ar", subject: "اقترحنا مواعيد بديلة" })]);
    api.previewNotificationTemplate.mockResolvedValue(preview());
  });
  afterEach(() => {
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });

  it("inserts a placeholder chip where the caret is, in the field that had focus", async () => {
    const { user, body } = await open();
    await user.click(body);
    body.setSelectionRange(18, 18);
    await user.click(screen.getByRole("button", { name: "Insert {{expires_at}}: When the suggested times expire" }));
    expect(body).toHaveValue("Choose one before {{expires_at}} please.");

    const subject = screen.getByLabelText(/^Title/) as HTMLInputElement;
    await user.click(subject);
    subject.setSelectionRange(subject.value.length, subject.value.length);
    await user.click(screen.getByRole("button", { name: "Insert {{reference}}: Booking reference (TRB-…)" }));
    expect(subject).toHaveValue("Other times suggested{{reference}}");
    // The other language's template is one click away.
    expect(screen.getByRole("link", { name: "Edit the Arabic version" })).toHaveAttribute("href", "/admin/settings/notifications/17");
  });

  it("refuses placeholders the event does not offer before saving", async () => {
    const { user, body } = await open();
    await user.clear(body);
    await user.click(body);
    await user.paste("Your request {{refund_note}} changed.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Not available for this event: {{refund_note}}. Use the placeholders listed below.")).toBeInTheDocument();
    expect(api.updateNotificationTemplate).not.toHaveBeenCalled();
  });

  it("previews the saved text on open, then the draft with sample values, in Arabic and English", async () => {
    const { user, body } = await open();
    await waitFor(() => expect(api.previewNotificationTemplate).toHaveBeenCalledWith(18, {}));
    const panel = screen.getByRole("heading", { name: "Preview" }).closest("section")!;
    const arabic = await within(panel).findByText("يُرجى اختيار أحدها قبل الثلاثاء 3 نوفمبر، 18:00.");
    expect(arabic.closest("[lang]")).toHaveAttribute("lang", "ar");
    expect(arabic.closest("[dir]")).toHaveAttribute("dir", "rtl");

    api.previewNotificationTemplate.mockResolvedValue(
      preview({ en: { subject: "Other times suggested", body: "Choose one for TRB-TEST01 please." }, unknown: [] }),
    );
    await user.clear(body);
    await user.click(body);
    await user.paste("Choose one for {{reference}} please.");
    await user.click(within(panel).getByText("Sample values"));
    const reference = within(panel).getByRole("group", { name: /\{\{reference\}\}/ });
    await user.type(within(reference).getByLabelText("English"), "TRB-TEST01");
    await user.click(within(panel).getByRole("button", { name: "Preview" }));

    await waitFor(() =>
      expect(api.previewNotificationTemplate).toHaveBeenLastCalledWith(18, {
        subject: "Other times suggested",
        body: "Choose one for {{reference}} please.",
        payload: { reference: { en: "TRB-TEST01" } },
      }),
    );
    expect((await within(panel).findByText("Choose one for TRB-TEST01 please.")).closest("[lang]")).toHaveAttribute("lang", "en");
    expect(api.updateNotificationTemplate).not.toHaveBeenCalled();
  });

  it("warns about placeholders the preview could not fill", async () => {
    api.previewNotificationTemplate.mockResolvedValue(preview({ unknown: ["nope"] }));
    await open();
    expect(await screen.findByText("These placeholders don't exist for this event and show as nothing: {{nope}}")).toBeInTheDocument();
  });

  it("saves only what changed with the loaded version, and switches the template off", async () => {
    api.updateNotificationTemplate.mockResolvedValue(template({ body: "Choose one before {{expires_at}}.", is_active: false, version: 5 }));
    const { user, body } = await open();
    await user.clear(body);
    await user.click(body);
    await user.paste("Choose one before {{expires_at}}.");
    await user.click(screen.getByRole("switch", { name: "Send this message" }));
    await user.type(screen.getByLabelText(/^Reason for the change/), "Shorter text");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateNotificationTemplate).toHaveBeenCalledWith(18, { body: "Choose one before {{expires_at}}.", is_active: false, reason: "Shorter text" }, 4),
    );
    expect(await screen.findByText("Other times suggested (English) saved.")).toBeInTheDocument();
    expect(screen.getByText("Version 5")).toBeInTheDocument();
  });

  it("asks to reload when someone else saved the template first", async () => {
    api.updateNotificationTemplate.mockRejectedValue(new AdminApiError(409, { code: "STALE_VERSION", message: "", details: {} }));
    const { user } = await open();
    await user.click(screen.getByRole("switch", { name: "Send this message" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "This record was changed" });
    api.fetchNotificationTemplate.mockResolvedValue(template({ version: 6 }));
    await user.click(within(dialog).getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("Version 6")).toBeInTheDocument();
  });
});
