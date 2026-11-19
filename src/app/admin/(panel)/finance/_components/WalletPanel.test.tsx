import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { txn, walletPage } from "@/test/financeFixtures";
import { renderWithProviders } from "@/test/render";
import { WalletPanel } from "./WalletPanel";

const api = { fetchCustomerWallet: vi.fn(), adjustCustomerWallet: vi.fn(), createExport: vi.fn(), fetchExport: vi.fn(), fetchExportUrl: vi.fn() };
vi.mock("@/lib/admin/finance/endpoints", () => ({
  fetchCustomerWallet: (...a: unknown[]) => api.fetchCustomerWallet(...a),
  adjustCustomerWallet: (...a: unknown[]) => api.adjustCustomerWallet(...a),
  createExport: (...a: unknown[]) => api.createExport(...a),
  fetchExport: (...a: unknown[]) => api.fetchExport(...a),
  fetchExportUrl: (...a: unknown[]) => api.fetchExportUrl(...a),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STAFF = ["customers.view", "payments.view", "refunds.create"];
const open = (permissions: readonly string[] = STAFF, locale: "en" | "ar" = "en") => renderWithProviders(<WalletPanel customerUlid="01C2" />, { permissions, locale });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchCustomerWallet.mockResolvedValue(walletPage());
});

describe("A09 customer balance panel", () => {
  it("shows the spendable balance, what expires in 30 days and every movement with who made it", async () => {
    api.fetchCustomerWallet.mockResolvedValue(
      walletPage({}, [
        txn(),
        txn({
          id: "02",
          type: "debit",
          source: "payment",
          source_label: { ar: "دفعة", en: "Payment" },
          amount_fils: 12000,
          balance_after_fils: 3000,
          remaining_fils: null,
          expires_at: null,
          note: null,
          created_by: { type: "customer", id: null, name: null },
          context: { type: null, id: null, reference: "TRB-7K2Q9M" },
        }),
        txn({ id: "03", source: "refund", source_label: { ar: "استرداد", en: "Refund" }, expires_at: null, created_by: { type: "system", id: null, name: null }, note: null }),
      ]),
    );
    open();
    await screen.findByText("Spendable balance");
    const panel = screen.getByRole("heading", { name: "Balance" }).closest("section")!;
    expect(panel).toHaveTextContent("Spendable balanceAED 150.00");
    expect(panel).toHaveTextContent("Expiring in 30 daysAED 50.00");
    const rows = within(within(panel).getByRole("table", { name: "Balance movements" })).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Credit");
    expect(rows[1]).toHaveTextContent("Goodwill credit");
    expect(rows[1]).toHaveTextContent("+");
    expect(rows[1]).toHaveTextContent("AED 150.00");
    expect(rows[1]).toHaveTextContent("Test Accountant");
    expect(rows[1]).toHaveTextContent("“Late arrival on 14 Nov”");
    expect(rows[1]).toHaveTextContent("2027");
    expect(rows[2]).toHaveTextContent("Debit");
    expect(rows[2]).toHaveTextContent("The customer");
    expect(rows[2]).toHaveTextContent("TRB-7K2Q9M");
    expect(within(rows[2]).getByText("AED 120.00").parentElement).toHaveTextContent("Taken");
    expect(rows[3]).toHaveTextContent("Never");
    expect(rows[3]).toHaveTextContent("The system");
  });

  it("says the balance is off, and keeps the correction while money is left in it", async () => {
    api.fetchCustomerWallet.mockResolvedValue(walletPage({ enabled: false, balance_fils: 4000 }));
    open();
    expect(await screen.findByText(/The customer balance is switched off, but this customer still has money in it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add credit" })).toBeDisabled();
    expect(screen.getByText("The balance is switched off.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct balance" })).toBeEnabled();
  });

  it("has nothing to take back from an empty balance, and an empty ledger says so", async () => {
    api.fetchCustomerWallet.mockResolvedValue(walletPage({ balance_fils: 0, expiring_30d_fils: 0 }, []));
    open();
    expect(await screen.findByText("No movements yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Correct balance" })).toBeDisabled();
    expect(screen.getByText("There is nothing to take back.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add credit" })).toBeEnabled();
  });

  it("offers the adjustments only with refunds.create, and the export only with reports.export", async () => {
    const { unmount } = open(["customers.view"]);
    await screen.findByText("Spendable balance");
    expect(screen.queryByRole("button", { name: "Add credit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct balance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export/ })).not.toBeInTheDocument();
    unmount();
    open([...STAFF, "reports.export"]);
    expect(await screen.findByRole("button", { name: /Export/ })).toBeInTheDocument();
  });

  it("shows an error with a retry, and reads in Arabic", async () => {
    api.fetchCustomerWallet.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue(walletPage());
    const user = userEvent.setup();
    const { unmount } = open();
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Spendable balance")).toBeInTheDocument();
    unmount();
    open(STAFF, "ar");
    expect(await screen.findByText("الرصيد القابل للإنفاق")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إضافة رصيد" })).toBeInTheDocument();
  });
});

describe("adding credit", () => {
  async function openCredit() {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Add credit" }));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("confirms the amount and sends it in fils with the goodwill reason, a key and the new balance comes back", async () => {
    api.adjustCustomerWallet.mockResolvedValue({ data: txn(), balance_fils: 30050 });
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText(/^Amount/), "150.50");
    await user.type(within(dialog).getByLabelText(/^Note/), "Late arrival on 14 Nov");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Step two: the exact amount, the balance now, nothing sent yet.
    expect(api.adjustCustomerWallet).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("CreditAED 150.50");
    expect(dialog).toHaveTextContent("Balance nowAED 150.00");
    expect(dialog).toHaveTextContent("the balance is credited at once and the customer is told");
    await user.click(within(dialog).getByRole("button", { name: "Add AED 150.50" }));
    await waitFor(() => expect(api.adjustCustomerWallet).toHaveBeenCalledTimes(1));
    expect(api.adjustCustomerWallet).toHaveBeenCalledWith("01C2", { type: "credit", amount_fils: 15050, reason_code: "goodwill", note: "Late arrival on 14 Nov" }, expect.stringMatching(UUID));
    expect(await screen.findByText("Credit added. The balance is now AED 300.50.")).toBeInTheDocument();
  });

  it("checks the amount and the note before anything is sent, with the single-credit cap", async () => {
    const { user, dialog } = await openCredit();
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("Enter the amount.")).toBeInTheDocument();
    expect(within(dialog).getByText("Write a note.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Amount/), "1000.01");
    await user.type(within(dialog).getByLabelText(/^Note/), "Late arrival");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("At most AED 1,000.00 is allowed here.")).toBeInTheDocument();
    expect(api.adjustCustomerWallet).not.toHaveBeenCalled();
  });

  it("says in words why the API refused: the balance is off, the account is closing", async () => {
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText(/^Amount/), "10");
    await user.type(within(dialog).getByLabelText(/^Note/), "Late arrival");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.adjustCustomerWallet.mockRejectedValueOnce(new AdminApiError(409, { code: "WALLET_DISABLED", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Add AED 10.00" }));
    expect(await within(dialog).findByText("The customer balance is switched off, so nothing can be credited to it.")).toBeInTheDocument();
    api.adjustCustomerWallet.mockRejectedValueOnce(new AdminApiError(409, { code: "ACCOUNT_CLOSING", message: "x", details: {} }));
    await user.click(within(dialog).getByRole("button", { name: "Add AED 10.00" }));
    expect(await within(dialog).findByText("This customer's account is being closed, so nothing can be credited to the balance.")).toBeInTheDocument();
  });

  it("keeps the same key after a lost answer, so a repeat never credits twice", async () => {
    api.adjustCustomerWallet.mockRejectedValueOnce(AdminApiError.network()).mockResolvedValue({ data: txn(), balance_fils: 16000 });
    const { user, dialog } = await openCredit();
    await user.type(within(dialog).getByLabelText(/^Amount/), "10");
    await user.type(within(dialog).getByLabelText(/^Note/), "Late arrival");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Add AED 10.00" }));
    expect(await within(dialog).findByText("We don't know yet whether this was saved")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add AED 10.00" }));
    await waitFor(() => expect(api.adjustCustomerWallet).toHaveBeenCalledTimes(2));
    expect(api.adjustCustomerWallet.mock.calls[1][2]).toBe(api.adjustCustomerWallet.mock.calls[0][2]);
  });
});

describe("correcting the balance", () => {
  async function openDebit() {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Correct balance" }));
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("takes back an amount with the correction reason, never more than the balance", async () => {
    api.adjustCustomerWallet.mockResolvedValue({ data: txn({ type: "debit", source: "correction" }), balance_fils: 13000 });
    const { user, dialog } = await openDebit();
    await user.type(within(dialog).getByLabelText(/^Amount/), "150.01");
    await user.type(within(dialog).getByLabelText(/^Note/), "Credited twice");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("At most AED 150.00 is allowed here.")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText(/^Amount/));
    await user.type(within(dialog).getByLabelText(/^Amount/), "20");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(dialog).toHaveTextContent("To take backAED 20.00");
    expect(dialog).toHaveTextContent("oldest credits first");
    await user.click(within(dialog).getByRole("button", { name: "Take back AED 20.00" }));
    await waitFor(() => expect(api.adjustCustomerWallet).toHaveBeenCalledTimes(1));
    expect(api.adjustCustomerWallet).toHaveBeenCalledWith("01C2", { type: "debit", amount_fils: 2000, reason_code: "correction", note: "Credited twice" }, expect.stringMatching(UUID));
    expect(await screen.findByText("Balance corrected. It is now AED 130.00.")).toBeInTheDocument();
  });

  it("names the balance when the API says it is not enough (the balance moved meanwhile)", async () => {
    const { user, dialog } = await openDebit();
    await user.type(within(dialog).getByLabelText(/^Amount/), "100");
    await user.type(within(dialog).getByLabelText(/^Note/), "Credited twice");
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.adjustCustomerWallet.mockRejectedValueOnce(new AdminApiError(422, { code: "WALLET_BALANCE_INSUFFICIENT", message: "x", details: { balance_fils: 5000, amount_fils: 10000 } }));
    await user.click(within(dialog).getByRole("button", { name: "Take back AED 100.00" }));
    expect(await within(dialog).findByText("The balance is only AED 50.00. Enter an amount up to the balance.")).toBeInTheDocument();
  });
});
