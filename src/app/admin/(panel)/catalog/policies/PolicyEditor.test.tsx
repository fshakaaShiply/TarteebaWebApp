import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { policies } from "@/test/catalogFixtures";
import { renderWithProviders } from "@/test/render";
import { PolicyEditor } from "./PoliciesScreen";

const api = { createPolicy: vi.fn(), updatePolicy: vi.fn(), fetchPolicies: vi.fn() };
vi.mock("@/lib/admin/endpoints", () => ({
  createPolicy: (...a: unknown[]) => api.createPolicy(...a),
  updatePolicy: (...a: unknown[]) => api.updatePolicy(...a),
  fetchPolicies: (...a: unknown[]) => api.fetchPolicies(...a),
}));

const cancellation = policies[0];

function edit() {
  const onClose = vi.fn();
  renderWithProviders(<PolicyEditor policy={cancellation} onClose={onClose} />, { permissions: ["catalog.manage"] });
  return { user: userEvent.setup(), onClose };
}

describe("A11 policy rules editor", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it("round-trips the rules through the JSON view and saves fils with the loaded version", async () => {
    api.updatePolicy.mockResolvedValue({ ...cancellation, version: 2 });
    const { user, onClose } = edit();

    expect(screen.getByRole("dialog", { name: "Edit policy: Cancellation policy" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tier 2: fee")).toHaveValue("50");

    await user.click(screen.getByRole("button", { name: "JSON view" }));
    const json = screen.getByLabelText("Rules (JSON)");
    expect((json as HTMLTextAreaElement).value).toContain('"fee_value": 50');

    const edited = {
      cancellation: [
        { min_hours_before: 24, fee_type: "fixed", fee_value: 2550 },
        { min_hours_before: 6, fee_type: "percent", fee_value: 40 },
        { min_hours_before: 0, fee_type: "percent", fee_value: 100 },
      ],
      company_cancellation: { refund_percent: 100, compensation: "credit" },
      exceptions: ["weather_alert"],
    };
    await user.clear(json);
    await user.click(json);
    await user.paste(JSON.stringify(edited));
    await user.click(screen.getByRole("button", { name: "Form view" }));

    // The form view shows the JSON values: fixed fees in AED.
    expect(screen.getByLabelText("Tier 1: fee type")).toHaveValue("fixed");
    expect(screen.getByLabelText("Tier 1: fee")).toHaveValue("25.50");
    expect(screen.getByLabelText("Tier 2: fee")).toHaveValue("40");
    expect(screen.getByLabelText(/^Compensation/)).toHaveValue("credit");

    await user.type(screen.getByLabelText(/Reason for the change/), "Owner approved D-02 values");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.updatePolicy).toHaveBeenCalledTimes(1));
    const [id, body, version] = api.updatePolicy.mock.calls[0];
    expect(id).toBe(1);
    expect(version).toBe(1);
    expect(body).toEqual({
      name: cancellation.name,
      rules: edited,
      is_active: true,
      reason: "Owner approved D-02 values",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the JSON view open when the text is not a JSON object", async () => {
    const { user } = edit();
    await user.click(screen.getByRole("button", { name: "JSON view" }));
    const json = screen.getByLabelText("Rules (JSON)");
    await user.clear(json);
    await user.click(json);
    await user.paste("{ not json");
    await user.click(screen.getByRole("button", { name: "Form view" }));
    expect(screen.getByText("This isn't a valid JSON object.")).toBeInTheDocument();
    expect(screen.getByLabelText("Rules (JSON)")).toBeInTheDocument();
  });

  it("refuses JSON the form cannot hold, keeps the text as typed and does not save it", async () => {
    const { user } = edit();
    await user.click(screen.getByRole("button", { name: "JSON view" }));
    const json = screen.getByLabelText("Rules (JSON)");
    const typed = JSON.stringify({
      cancellation: [{ min_hours_before: 24, fee_type: "percent", fee_value: 0, note: "early" }],
      notes: "owner draft",
    });
    await user.clear(json);
    await user.click(json);
    await user.paste(typed);

    await user.click(screen.getByRole("button", { name: "Form view" }));
    expect(screen.getByText(/The form can't hold these entries, and the API doesn't accept them: .*notes, cancellation\.0\.note/)).toBeInTheDocument();
    expect(screen.getByLabelText("Rules (JSON)")).toHaveValue(typed);

    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.updatePolicy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Rules (JSON)")).toHaveValue(typed);
    expect(screen.getByLabelText("Rules (JSON)")).toHaveAttribute("aria-invalid", "true");
  });

  it("opens the JSON view only once the form's fields are valid, so nothing typed is replaced", async () => {
    const { user } = edit();
    const hours = screen.getByLabelText("Tier 1: hours before the visit");
    await user.clear(hours);
    await user.type(hours, "abc");
    await user.click(screen.getByRole("button", { name: "JSON view" }));

    expect(await screen.findByText("Fix the highlighted fields before opening the JSON view.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rules (JSON)")).not.toBeInTheDocument();
    expect(hours).toHaveValue("abc");
    // The tier's error is announced with the input.
    await waitFor(() => expect(hours).toHaveAttribute("aria-invalid", "true"));
    expect(hours).toHaveAccessibleDescription("Enter 0 to 720 hours.");

    await user.clear(hours);
    await user.type(hours, "48");
    expect(screen.queryByText("Fix the highlighted fields before opening the JSON view.")).not.toBeInTheDocument();
    await waitFor(() => expect(hours).not.toHaveAttribute("aria-invalid"));
    await user.click(screen.getByRole("button", { name: "JSON view" }));
    expect((screen.getByLabelText("Rules (JSON)") as HTMLTextAreaElement).value).toContain('"min_hours_before": 48');
  });

  it("checks tiers before saving and shows API rule errors on the matching field", async () => {
    api.updatePolicy.mockImplementation(async () => {
      throw new AdminApiError(422, {
        code: "VALIDATION_FAILED",
        message: "Some fields need your attention.",
        details: { fields: { "rules.cancellation.2.min_hours_before": ["The hours must be distinct."] } },
      });
    });
    const { user } = edit();

    const fee = screen.getByLabelText("Tier 2: fee");
    await user.clear(fee);
    await user.type(fee, "120");
    await user.type(screen.getByLabelText(/Reason for the change/), "x");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter a whole percentage from 0 to 100.")).toBeInTheDocument();
    expect(api.updatePolicy).not.toHaveBeenCalled();

    await user.clear(fee);
    await user.type(fee, "60");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("The hours must be distinct.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tier 3: hours before the visit")).toHaveAttribute("aria-invalid", "true");
  });

  it("creates a reschedule policy with its required section and an upper-case code", async () => {
    api.createPolicy.mockResolvedValue({ ...policies[1], id: 9, code: "RESCHEDULE_VIP" });
    const onClose = vi.fn();
    renderWithProviders(<PolicyEditor policy={null} onClose={onClose} />, { permissions: ["catalog.manage"] });
    const user = userEvent.setup();

    const dialog = screen.getByRole("dialog", { name: "New policy" });
    await user.type(within(dialog).getByLabelText(/^Code/), "reschedule_vip");
    await user.selectOptions(within(dialog).getByLabelText(/^Type/), "reschedule");
    expect(within(dialog).getByRole("switch", { name: "Rescheduling" })).toBeDisabled();
    expect(within(dialog).getByRole("switch", { name: "Rescheduling" })).toHaveAttribute("aria-checked", "true");
    await user.type(within(dialog).getByLabelText(/^Name \(Arabic\)/), "إعادة جدولة مميزة");
    await user.type(within(dialog).getByLabelText(/^Name \(English\)/), "VIP reschedule");
    const fee = within(dialog).getByLabelText(/^Fee after the cut-off/);
    await user.clear(fee);
    await user.type(fee, "30");
    await user.type(within(dialog).getByLabelText(/Reason for the change/), "New VIP terms");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.createPolicy).toHaveBeenCalledTimes(1));
    expect(api.createPolicy.mock.calls[0][0]).toEqual({
      code: "RESCHEDULE_VIP",
      type: "reschedule",
      name: { ar: "إعادة جدولة مميزة", en: "VIP reschedule" },
      rules: {
        reschedule: { free_until_hours_before: 24, fee_fils_after: 3000, max_per_booking: 2, requires_approval: true },
        exceptions: ["weather_alert", "medical_with_proof"],
      },
      is_active: false,
      reason: "New VIP terms",
    });
  });
});
