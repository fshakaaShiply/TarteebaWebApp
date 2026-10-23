import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationTemplate } from "@/lib/admin/types";
import { renderWithProviders } from "@/test/render";
import { NotificationTemplatesScreen } from "./NotificationTemplatesScreen";

const api = { fetchNotificationTemplates: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  fetchNotificationTemplates: (...a: unknown[]) => api.fetchNotificationTemplates(...a),
}));

let nextId = 1;
const template = (over: Partial<NotificationTemplate>): NotificationTemplate => ({
  id: nextId++,
  event_key: "booking.confirmed",
  event_label: "Booking confirmed",
  group: "bookings",
  audience: "customer",
  channel: "push",
  channel_label: "Push notifications",
  locale: "ar",
  subject: "تم تأكيد حجزك",
  body: "تم تأكيد حجزك {{reference}}.",
  is_active: true,
  version: 1,
  placeholders: [],
  updated_by: null,
  updated_at: null,
  ...over,
});

describe("NotificationTemplatesScreen", () => {
  beforeEach(() => {
    nextId = 1;
    api.fetchNotificationTemplates.mockReset();
    api.fetchNotificationTemplates.mockResolvedValue([
      template({}),
      template({ locale: "en", subject: "Booking confirmed", body: "Your booking {{reference}} is confirmed." }),
      template({ channel: "sms", channel_label: "Text messages (SMS)", subject: null, is_active: false }),
      template({ event_key: "refund.succeeded", event_label: "Refund completed", group: "payments", channel: "email", channel_label: "Email", locale: "en", subject: "Your refund" }),
    ]);
  });

  it("groups templates by event with the Arabic and English text side by side", async () => {
    renderWithProviders(<NotificationTemplatesScreen />, { permissions: ["settings.manage"] });
    const confirmed = await screen.findByRole("table", { name: "Templates for Booking confirmed" });
    const rows = within(confirmed).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Push notifications");
    expect(within(rows[1]).getByRole("link", { name: "Edit Booking confirmed, Push notifications, Arabic" })).toHaveAttribute("href", "/admin/settings/notifications/1");
    expect(within(rows[1]).getByRole("link", { name: "Edit Booking confirmed, Push notifications, English" })).toHaveAttribute("href", "/admin/settings/notifications/2");
    // The SMS has no English template in this set, and its Arabic one is switched off.
    expect(rows[2]).toHaveTextContent("Off");
    expect(rows[2]).toHaveTextContent("None");
    expect(screen.getByRole("heading", { name: "Payments and refunds" })).toBeInTheDocument();
    expect(screen.getByText("4 templates, 3 switched on.")).toBeInTheDocument();
  });

  it("filters by channel and by whether a template is sent", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationTemplatesScreen />, { permissions: ["settings.manage"] });
    await screen.findByRole("table", { name: "Templates for Booking confirmed" });
    await user.selectOptions(screen.getByLabelText("Channel"), "email");
    expect(screen.queryByRole("table", { name: "Templates for Booking confirmed" })).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Templates for Refund completed" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Channel"), "");
    await user.selectOptions(screen.getByLabelText("Sending"), "inactive");
    const confirmed = screen.getByRole("table", { name: "Templates for Booking confirmed" });
    expect(within(confirmed).getAllByRole("row")).toHaveLength(2);
  });

  it("is only for settings.manage", () => {
    renderWithProviders(<NotificationTemplatesScreen />, { permissions: ["catalog.manage"] });
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
    expect(api.fetchNotificationTemplates).not.toHaveBeenCalled();
  });
});
