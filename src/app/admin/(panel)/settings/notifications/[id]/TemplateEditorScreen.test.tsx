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
  const body = (await screen.findByRole("textbox", { name: /^Text/ })) as HTMLTextAreaElement;
  return { user, body };
}

const subjectField = () => screen.getByRole("textbox", { name: /^Title/ }) as HTMLInputElement;
const previewPanel = () => screen.getByRole("heading", { name: "Preview" }).closest("section")!;

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

    const subject = subjectField();
    await user.click(subject);
    subject.setSelectionRange(subject.value.length, subject.value.length);
    await user.click(screen.getByRole("button", { name: "Insert {{reference}}: Booking reference (TRB-…)" }));
    expect(subject).toHaveValue("Other times suggested{{reference}}");
    // The other language's template is one click away.
    expect(screen.getByRole("link", { name: "Edit the Arabic version" })).toHaveAttribute("href", "/admin/settings/notifications/17");
  });

  it("inserts into the title with the keyboard only, through the Insert into choice", async () => {
    const { user, body } = await open();
    const subject = subjectField();
    const into = screen.getByRole("radiogroup", { name: "Insert into" });
    // Focus follows the fields: tabbing from the title to the chips passes the text, which becomes the target.
    subject.focus();
    await user.tab();
    expect(body).toHaveFocus();
    expect(within(into).getByRole("radio", { name: "Text" })).toBeChecked();
    await user.tab({ shift: true });
    expect(subject).toHaveFocus();
    expect(within(into).getByRole("radio", { name: "Title" })).toBeChecked();
    subject.setSelectionRange(0, 0);
    await user.tab();
    expect(within(into).getByRole("radio", { name: "Text" })).toBeChecked();

    // The admin picks the title in the radio group and presses Enter on a chip: no pointer involved.
    within(into).getByRole("radio", { name: "Title" }).focus();
    await user.keyboard(" ");
    expect(within(into).getByRole("radio", { name: "Title" })).toBeChecked();
    screen.getByRole("button", { name: "Insert {{reference}}: Booking reference (TRB-…)" }).focus();
    await user.keyboard("{Enter}");
    expect(subject).toHaveValue("{{reference}}Other times suggested");
    expect(body).toHaveValue("Choose one before  please.");
  });

  it("offers no title target for a channel without a title", async () => {
    api.fetchNotificationTemplate.mockResolvedValue(template({ channel: "sms", channel_label: "Text messages (SMS)", subject: null }));
    await open();
    expect(screen.queryByRole("radiogroup", { name: "Insert into" })).not.toBeInTheDocument();
  });

  it("asks again when Preview is pressed after an error with the same draft, and offers a retry", async () => {
    const { user } = await open();
    await within(previewPanel()).findByText("Choose one before Tuesday 3 November, 18:00 please.");
    api.previewNotificationTemplate.mockRejectedValue(AdminApiError.network());
    await user.click(within(previewPanel()).getByRole("button", { name: "Preview" }));
    expect(await within(previewPanel()).findByRole("button", { name: "Try again" })).toBeInTheDocument();
    const calls = api.previewNotificationTemplate.mock.calls.length;

    // Same draft, same query key: pressing Preview must still ask the API again.
    await user.click(within(previewPanel()).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(api.previewNotificationTemplate.mock.calls.length).toBe(calls + 1));

    api.previewNotificationTemplate.mockResolvedValue(preview());
    await user.click(await within(previewPanel()).findByRole("button", { name: "Try again" }));
    expect(await within(previewPanel()).findByText("Choose one before Tuesday 3 November, 18:00 please.")).toBeInTheDocument();
    expect(api.previewNotificationTemplate.mock.calls.length).toBe(calls + 2);
  });

  it("announces each requested preview in a live region that stays on the page", async () => {
    const { user, body } = await open();
    await within(previewPanel()).findByText("Choose one before Tuesday 3 November, 18:00 please.");
    // The preview shown on open was not asked for: nothing is announced.
    const live = within(previewPanel()).getByRole("status");
    expect(live).toBeEmptyDOMElement();

    api.previewNotificationTemplate.mockResolvedValue(preview({ en: { subject: "Other times suggested", body: "Pick a time." } }));
    await user.clear(body);
    await user.click(body);
    await user.paste("Pick a time.");
    await user.click(within(previewPanel()).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(live).toHaveTextContent("Preview updated."));
    expect(within(previewPanel()).getByRole("status")).toBe(live);
    expect(within(previewPanel()).getByText("Pick a time.")).toBeInTheDocument();
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
