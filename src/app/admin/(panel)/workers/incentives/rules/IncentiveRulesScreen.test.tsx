import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { rule } from "@/test/workforceFixtures";
import { renderWithProviders } from "@/test/render";
import { IncentiveRulesScreen } from "./IncentiveRulesScreen";

const api = { fetchRules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn(), activateRule: vi.fn(), deactivateRule: vi.fn(), previewRule: vi.fn() };
vi.mock("@/lib/admin/workforce/endpoints", () => ({
  fetchRules: (...a: unknown[]) => api.fetchRules(...a),
  createRule: (...a: unknown[]) => api.createRule(...a),
  updateRule: (...a: unknown[]) => api.updateRule(...a),
  deleteRule: (...a: unknown[]) => api.deleteRule(...a),
  activateRule: (...a: unknown[]) => api.activateRule(...a),
  deactivateRule: (...a: unknown[]) => api.deactivateRule(...a),
  previewRule: (...a: unknown[]) => api.previewRule(...a),
}));

const HR = ["incentives.approve"];
const consoleError = vi.spyOn(console, "error");
const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const inactive = rule({ id: 9, name: { ar: "قاعدة بديلة", en: "Draft rule" }, is_active: false, activated_at: null, version: 1 });
const open = (rules = [rule(), inactive], locale: "en" | "ar" = "en") => {
  api.fetchRules.mockResolvedValue(rules);
  return renderWithProviders(<IncentiveRulesScreen />, { permissions: HR, locale });
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  consoleError.mockClear();
});

describe("A05 incentive rules (workforce §3.4)", () => {
  it("lists the rules with the active one marked and its weights, hours, ratings and tiers written out", async () => {
    open();
    const card = (await screen.findByText("Incentive rule")).closest("section")!;
    expect(card).toHaveTextContent("Active");
    expect(card).toHaveTextContent("Hours 40 · Rating 30 · Punctuality 20 · Asked for by name 10");
    expect(card).toHaveTextContent("Target 160 h · minimum 80 h");
    expect(card).toHaveTextContent("From 3.00 stars · at least 5 ratings");
    expect(card).toHaveTextContent("At most 2");
    expect(card).toHaveTextContent("from 60%: AED 200.00 · from 75%: AED 350.00 · from 90%: AED 500.00");
    expect(card).toHaveTextContent("Past proposals keep the rule they were computed with");
    const draft = screen.getByText("Draft rule").closest("section")!;
    expect(draft).toHaveTextContent("Inactive");
    // Only an inactive rule can be deleted.
    expect(within(card).queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: "Delete Draft rule" })).toBeInTheDocument();
  });

  it("says when no rule is active, and shows an empty state with no rules", async () => {
    open([inactive]);
    expect(await screen.findByText("No rule is active, so incentives cannot be computed.")).toBeInTheDocument();
    api.fetchRules.mockResolvedValue([]);
    const { unmount } = renderWithProviders(<IncentiveRulesScreen />, { permissions: HR });
    expect(await screen.findByText("No rules yet")).toBeInTheDocument();
    unmount();
  });

  it("creates a rule from the design's starting scheme once it has a name, converting hours, percent and AED", async () => {
    api.createRule.mockResolvedValue(rule({ id: 10, is_active: false }));
    open([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New rule" }));
    const dialog = screen.getByRole("dialog", { name: "New incentive rule" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getAllByText("Write the name (up to 100 characters).")).toHaveLength(2);
    expect(api.createRule).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Name in Arabic/), "قاعدة الخريف");
    await user.type(within(dialog).getByLabelText(/Name in English/), "Autumn rule");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createRule).toHaveBeenCalledTimes(1));
    expect(api.createRule.mock.calls[0][0]).toEqual({
      name: { ar: "قاعدة الخريف", en: "Autumn rule" },
      weights: { hours: 40, rating: 30, punctuality: 20, repeat_requests: 10 },
      thresholds: { hours_target_minutes: 9600, min_hours_minutes: 4800, rating_floor_x100: 300, min_ratings: 5, max_absent_days: 2 },
      amounts: [
        { min_score_bp: 6000, amount_fils: 20000 },
        { min_score_bp: 7500, amount_fils: 35000 },
        { min_score_bp: 9000, amount_fils: 50000 },
      ],
    });
    expect(await screen.findByText("Rule created.")).toBeInTheDocument();
  });

  it("checks the form the way the API does, field by field, before sending", async () => {
    open([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New rule" }));
    const dialog = screen.getByRole("dialog", { name: "New incentive rule" });
    await user.type(within(dialog).getByLabelText(/Name in Arabic/), "ق");
    await user.type(within(dialog).getByLabelText(/Name in English/), "R");
    await user.clear(within(dialog).getByLabelText(/Minimum hours/));
    await user.type(within(dialog).getByLabelText(/Minimum hours/), "170");
    await user.clear(within(dialog).getByLabelText("Tier 2: amount"));
    await user.type(within(dialog).getByLabelText("Tier 2: amount"), "150");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("The minimum cannot be more than the target.")).toBeInTheDocument();
    expect(within(dialog).getByText("Each tier needs a higher score and a higher amount than the one before.")).toBeInTheDocument();
    expect(api.createRule).not.toHaveBeenCalled();
    // At most five tiers.
    for (let i = 0; i < 2; i++) await user.click(within(dialog).getByRole("button", { name: "Add a tier" }));
    expect(within(dialog).getByRole("button", { name: "Add a tier" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Remove tier 5" }));
    expect(within(dialog).getByRole("button", { name: "Add a tier" })).toBeEnabled();
  });

  it("puts the API's RULE_INVALID messages on the fields they name", async () => {
    api.createRule.mockRejectedValue(apiError(422, "RULE_INVALID", { fields: { "amounts.0.amount_fils": ["The amount must be between 0.01 and 10,000.00."], "thresholds.min_ratings": ["Too many."] } }));
    open([]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New rule" }));
    const dialog = screen.getByRole("dialog", { name: "New incentive rule" });
    await user.type(within(dialog).getByLabelText(/Name in Arabic/), "ق");
    await user.type(within(dialog).getByLabelText(/Name in English/), "R");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("The amount must be between 0.01 and 10,000.00.")).toBeInTheDocument();
    expect(within(dialog).getByText("Too many.")).toBeInTheDocument();
  });

  it("edits with the rule's version as If-Match, round-tripping the stored values", async () => {
    api.updateRule.mockResolvedValue(rule({ version: 3 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Incentive rule" }));
    const dialog = screen.getByRole("dialog", { name: "Edit the rule" });
    expect(within(dialog).getByLabelText(/Hours target/)).toHaveValue("160");
    expect(within(dialog).getByLabelText(/Rating floor/)).toHaveValue("3.00");
    expect(within(dialog).getByLabelText("Tier 3: amount")).toHaveValue("500.00");
    await user.clear(within(dialog).getByLabelText(/Ratings needed/));
    await user.type(within(dialog).getByLabelText(/Ratings needed/), "8");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledTimes(1));
    expect(api.updateRule.mock.calls[0][0]).toBe(8);
    expect(api.updateRule.mock.calls[0][1]).toMatchObject({ thresholds: { min_ratings: 8, hours_target_minutes: 9600 }, amounts: rule().amounts });
    expect(api.updateRule.mock.calls[0][2]).toBe(2);
  });

  it("after a 409 STALE_VERSION shows the rule as saved now, keeps the typed edit and sends the new version", async () => {
    api.updateRule.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 3 })).mockResolvedValueOnce(rule({ version: 4 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit Incentive rule" }));
    const dialog = screen.getByRole("dialog", { name: "Edit the rule" });
    await user.clear(within(dialog).getByLabelText(/Ratings needed/));
    await user.type(within(dialog).getByLabelText(/Ratings needed/), "9");
    api.fetchRules.mockResolvedValue([rule({ version: 3 }), inactive]);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/This rule changed while you were working/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Ratings needed/)).toHaveValue("9");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateRule).toHaveBeenCalledTimes(2));
    expect(api.updateRule.mock.calls.map((c) => c[2])).toEqual([2, 3]);
  });

  it("activates a rule after saying the active one is switched off, and deactivates the active one", async () => {
    api.activateRule.mockResolvedValue(rule({ id: 9, is_active: true }));
    api.deactivateRule.mockResolvedValue(rule({ is_active: false }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Activate Draft rule" }));
    const dialog = screen.getByRole("alertdialog", { name: "Activate this rule?" });
    expect(dialog).toHaveTextContent("The rule active now is switched off.");
    await user.click(within(dialog).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(api.activateRule).toHaveBeenCalledWith(9, 1));
    await user.click(await screen.findByRole("button", { name: "Deactivate Incentive rule" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Deactivate this rule?" })).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(api.deactivateRule).toHaveBeenCalledWith(8, 2));
  });

  it("deletes an inactive rule with its version, and explains RULE_ACTIVE if it became the active one", async () => {
    api.deleteRule.mockRejectedValueOnce(apiError(409, "RULE_ACTIVE", { rule_id: 9 }));
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete Draft rule" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete this rule?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.deleteRule).toHaveBeenCalledWith(9, 1));
    expect(await within(dialog).findByText("The active rule cannot be deleted. Deactivate it first.")).toBeInTheDocument();
  });

  it("previews a month for a rule and stores nothing: each cleaner's score, amount and the gate that held her back", async () => {
    api.previewRule.mockResolvedValue({
      period: "2026-09",
      workers: [
        { worker: { id: 3, display_name: "Maria S." }, score_bp: 8292, proposed_fils: 35000, gates: [] },
        { worker: { id: 5, display_name: "Lakshmi N." }, score_bp: 0, proposed_fils: 0, gates: ["min_hours"] },
      ],
      totals: { count: 2, fils: 35000 },
    });
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Preview a month with Incentive rule" }));
    const dialog = screen.getByRole("dialog", { name: "Preview a month" });
    expect(dialog).toHaveTextContent("Nothing is stored or proposed.");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Month" }), "2026-08");
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(api.previewRule).toHaveBeenCalledWith(8, "2026-08"));
    const rows = within(await within(dialog).findByRole("table")).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Maria S.");
    expect(rows[1]).toHaveTextContent("82.92%");
    expect(rows[1]).toHaveTextContent("AED 350.00");
    expect(rows[2]).toHaveTextContent("Fewer hours than the rule's minimum");
    expect(dialog).toHaveTextContent("2 cleaners, AED 350.00 in all.");
  });

  it("needs incentives.approve, and is written in Arabic", async () => {
    renderWithProviders(<IncentiveRulesScreen />, { permissions: ["workers.view"] });
    expect(api.fetchRules).not.toHaveBeenCalled();
    open([rule()], "ar");
    expect(await screen.findByText("قاعدة الحوافز", { selector: "bdi" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("قواعد الحوافز");
    expect(screen.getByText("مفعّلة")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/MISSING_MESSAGE/);
  });
});
