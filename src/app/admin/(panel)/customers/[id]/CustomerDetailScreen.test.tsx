import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { bookingRow } from "@/test/bookingFixtures";
import { CUSTOMER_ULID, blockedCustomer, customerDetail, customerNote } from "@/test/customerFixtures";
import { walletPage } from "@/test/financeFixtures";
import { subscriptionRow } from "@/test/subscriptionFixtures";
import { renderWithProviders } from "@/test/render";
import { CustomerDetailScreen } from "./CustomerDetailScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => `/admin/customers/${CUSTOMER_ULID}`,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  fetchCustomer: vi.fn(),
  fetchCustomerNotes: vi.fn(),
  addCustomerNote: vi.fn(),
  fetchLinked: vi.fn(),
  blockCustomer: vi.fn(),
  unblockCustomer: vi.fn(),
  optOutMarketing: vi.fn(),
  blockAddress: vi.fn(),
  unblockAddress: vi.fn(),
  fetchDeletionImpact: vi.fn(),
  sendPrivacyOtp: vi.fn(),
  createPrivacyRequest: vi.fn(),
}));
vi.mock("@/lib/admin/customers/endpoints", () => api);

const finance = vi.hoisted(() => ({ fetchCustomerWallet: vi.fn() }));
vi.mock("@/lib/admin/finance/endpoints", () => finance);
// The wallet panel is W1's and has its own tests: here only that the tab mounts it for this customer.
vi.mock("../../finance/_components/WalletPanel", () => ({ WalletPanel: ({ customerUlid }: { customerUlid: string }) => <div>Wallet panel of {customerUlid}</div> }));

const COORDINATOR = ["customers.view", "customers.notes", "customers.block", "customers.privacy_requests", "bookings.view", "subscriptions.view", "payments.view", "complaints.manage"];
const staleError = () => new AdminApiError(409, { code: "STALE_VERSION", message: "stale", details: { current_version: 3 } });
const page = <T,>(rows: T[]) => ({ data: rows, meta: { current_page: 1, per_page: 10, total: rows.length, last_page: 1 } });

function open(permissions: readonly string[] = COORDINATOR, locale: "en" | "ar" = "en", id: string = CUSTOMER_ULID) {
  return renderWithProviders(<CustomerDetailScreen id={id} />, { permissions, locale });
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  finance.fetchCustomerWallet.mockReset();
  api.fetchCustomer.mockResolvedValue(customerDetail());
  api.fetchCustomerNotes.mockResolvedValue(page([customerNote()]));
  api.fetchLinked.mockImplementation(async (link: { path: string }) => {
    if (link.path.endsWith("/bookings")) return page([bookingRow({ id: 90, reference: "TRB-OPEN01", service_date: "2026-10-30", status: "confirmed", status_label: { ar: "مؤكد", en: "Confirmed" }, total_fils: 24000 }), bookingRow({ id: 91, reference: "TRB-DONE01", service_date: "2026-10-12", status: "completed", status_label: { ar: "مكتمل", en: "Completed" }, total_fils: 18000 })]);
    if (link.path.endsWith("/subscriptions")) return page([subscriptionRow({ id: 31, reference: "TRS-7K2M9Q", first_visit_at: "2026-11-01T06:00:00+00:00" })]);
    return page([]);
  });
  finance.fetchCustomerWallet.mockResolvedValue(walletPage());
});

describe("A07 profile", () => {
  it("shows who she is: status, contact, the design's profile card and every figure from the API", async () => {
    open();
    expect(await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" })).toBeInTheDocument();
    const header = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(within(header).getByText("Active")).toBeInTheDocument();
    expect(within(header).getByText("+971559871234")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Profile" }).closest("section")!;
    expect(card).toHaveTextContent("Bookings14 · 1 cancelled");
    expect(card).toHaveTextContent("Open now1 booking · 1 subscription");
    expect(card).toHaveTextContent("Total paidAED 3,120.00");
    expect(card).toHaveTextContent("Preferred cleanersMaria (3), Joy (2)");
    expect(card).toHaveTextContent("MarketingNot agreed");
    expect(card).toHaveTextContent("4.8");
    expect(api.fetchCustomer).toHaveBeenCalledWith(CUSTOMER_ULID);
  });

  it("dates 'customer since' by the Dubai day of the instant, as the list does, not by its UTC day", async () => {
    // 02:00 on 19 Nov in Dubai is still 18 Nov in UTC.
    api.fetchCustomer.mockResolvedValue(customerDetail({ created_at: "2026-11-18T22:00:00+00:00", stats: { ...customerDetail().stats, bookings_open: 2, subscriptions_open: 0 } }));
    open();
    const card = (await screen.findByRole("heading", { name: "Profile" })).closest("section")!;
    expect(card).toHaveTextContent("Customer sinceThu, 19 Nov 2026");
    expect(card).not.toHaveTextContent("18 Nov 2026");
    expect(card).toHaveTextContent("Open now2 bookings · 0 subscriptions");
  });

  it("counts the open items in Arabic with the right plural", async () => {
    api.fetchCustomer.mockResolvedValue(customerDetail({ stats: { ...customerDetail().stats, bookings_open: 2, subscriptions_open: 1 } }));
    open(COORDINATOR, "ar");
    const card = (await screen.findByRole("heading", { name: "الملف" })).closest("section")!;
    expect(card).toHaveTextContent("حجزان · اشتراك واحد");
  });

  it("merges her latest bookings and subscriptions by date through the profile's links", async () => {
    open();
    const table = await screen.findByRole("table", { name: "Recent bookings and subscriptions of the customer" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4));
    const rows = within(table).getAllByRole("row").slice(1);
    // The subscription's first visit (1 Nov) comes before the bookings of 30 and 12 Oct.
    expect(rows.map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual(["TRS-7K2M9Q", "TRB-OPEN01", "TRB-DONE01"]);
    expect(within(rows[1]).getByRole("link", { name: "TRB-OPEN01" })).toHaveAttribute("href", "/admin/bookings/90");
    expect(within(rows[0]).getByRole("link", { name: "TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(rows[1]).toHaveTextContent("AED 240.00");
    // The link's own parameters (her ULID) are the filter; the booking list asks for single bookings, five of them.
    expect(api.fetchLinked).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/admin/bookings", params: { customer_id: CUSTOMER_ULID } }), { perPage: 5, extra: { kind: "single" } });
  });

  it("lists her notes with author, role and time, and adds one", async () => {
    open();
    expect(await screen.findByText("Prefers a call after 4 pm. Side gate of the villa.")).toBeInTheDocument();
    expect(screen.getByText(/Lina \(Booking coordinator\)/)).toBeInTheDocument();
    expect(screen.getByText(/Staff only: these never reach the customer/)).toBeInTheDocument();
    api.addCustomerNote.mockResolvedValue(customerNote({ id: 6 }));
    // An empty note is refused on the page.
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Write the note first.")).toBeInTheDocument();
    expect(api.addCustomerNote).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Add a note"), "  Asked for the same cleaner  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.addCustomerNote).toHaveBeenCalledWith(CUSTOMER_ULID, "Asked for the same cleaner"));
    await waitFor(() => expect(screen.getByLabelText("Add a note")).toHaveValue(""));
    // Said aloud too (the toast's live region), not only by the list changing.
    expect((await screen.findByText("Note added")).closest("[role=status]")).not.toBeNull();
  });

  it("offers no note box without customers.notes, and reads the notes with customers.view alone", async () => {
    api.fetchCustomer.mockResolvedValue(customerDetail({ actions: { block: false, unblock: false, add_note: false, block_address: false, privacy_request: false, marketing_opt_out: false } }));
    open(["customers.view"]);
    expect(await screen.findByText("Prefers a call after 4 pm. Side gate of the villa.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a note")).toBeNull();
    expect(screen.queryByRole("button", { name: "Block customer" })).toBeNull();
  });

  it("speaks Arabic and keeps the phone and e-mail in Latin", async () => {
    open(COORDINATOR, "ar");
    expect(await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حظر العميل" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الملف" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ملاحظات داخلية" })).toBeInTheDocument();
    const header = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(within(header).getByText("+971559871234").closest("bdi")).toHaveAttribute("dir", "ltr");
  });

  it("says when the customer is not found, for a number that is not a ULID too", async () => {
    api.fetchCustomer.mockRejectedValue(new AdminApiError(404, { code: "NOT_FOUND", message: "", details: {} }));
    const { unmount } = open();
    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    unmount();
    api.fetchCustomer.mockClear();
    open(COORDINATOR, "en", "12");
    expect(await screen.findByText("Customer not found")).toBeInTheDocument();
    expect(api.fetchCustomer).not.toHaveBeenCalled();
  });

  it("shows a failed load with a retry, and denies staff without customers.view", async () => {
    api.fetchCustomer.mockRejectedValueOnce(new AdminApiError(500, { code: "SERVER_ERROR", message: "", details: {} }));
    const { unmount } = open();
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" })).toBeInTheDocument();
    unmount();
    api.fetchCustomer.mockClear();
    open(["bookings.view"]);
    expect(screen.getByText(/don.t have access/i)).toBeInTheDocument();
    expect(api.fetchCustomer).not.toHaveBeenCalled();
  });
});

describe("tabs", () => {
  it("renders only the tabs her permissions give her a list for", async () => {
    api.fetchCustomer.mockResolvedValue(customerDetail({ links: { ...customerDetail().links, payments: null, complaints: null, ratings: null, wallet: null } }));
    open(["customers.view"]);
    await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" });
    const tabs = within(screen.getByRole("tablist", { name: "Customer sections" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Privacy"]);
  });

  it("keeps the Quality tab for staff who work cases: the accountant reads cases elsewhere", async () => {
    open(["customers.view", "compensation.approve", "payments.view"]);
    await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" });
    // The Balance tab follows the wallet read.
    await screen.findByRole("tab", { name: "Balance" });
    const tabs = within(screen.getByRole("tablist", { name: "Customer sections" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Payments", "Balance", "Privacy"]);
  });

  it("opens payments and cases from the owning modules' lists", async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Payments" }));
    expect(api.fetchLinked).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/admin/payments" }), expect.objectContaining({ page: 1, perPage: 10 }));
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Quality" }));
    expect(await screen.findByText("No complaints or support requests")).toBeInTheDocument();
    expect(screen.getByText("She has not rated a visit yet")).toBeInTheDocument();
    expect(api.fetchLinked).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/admin/complaints" }), expect.anything());
    expect(api.fetchLinked).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/admin/ratings" }), expect.anything());
  });

  it("mounts the finance balance panel on the Balance tab while the balance is on", async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Balance" }));
    expect(await screen.findByText(`Wallet panel of ${CUSTOMER_ULID}`)).toBeInTheDocument();
    expect(finance.fetchCustomerWallet).toHaveBeenCalledWith(CUSTOMER_ULID, { page: 1, perPage: 25 });
  });

  it("hides the Balance tab while the balance is off and empty, and keeps it while money is left (P5-C62)", async () => {
    finance.fetchCustomerWallet.mockResolvedValue(walletPage({ enabled: false, balance_fils: 0 }));
    const { unmount } = open();
    await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" });
    await waitFor(() => expect(finance.fetchCustomerWallet).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: "Balance" })).toBeNull();
    unmount();
    finance.fetchCustomerWallet.mockResolvedValue(walletPage({ enabled: false, balance_fils: 4000 }));
    open();
    expect(await screen.findByRole("tab", { name: "Balance" })).toBeInTheDocument();
  });
});

describe("blocking", () => {
  it("shows a blocked customer's banner: the reason, who blocked and when, and what it means", async () => {
    api.fetchCustomer.mockResolvedValue(blockedCustomer());
    open();
    const banner = (await screen.findByText("Customer blocked")).closest("[role]")!;
    expect(banner).toHaveTextContent("Reason: Abuse towards a cleaner");
    expect(banner).toHaveTextContent("Blocked by Huda on");
    expect(banner).toHaveTextContent("Her open bookings stay for you to decide.");
    expect(screen.getByRole("button", { name: "Unblock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change block reason" })).toBeInTheDocument();
  });

  it("asks for a reason, lists the open bookings and subscriptions, and sends the reason with the version as If-Match", async () => {
    open();
    await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" });
    await waitFor(() => expect(screen.getByRole("link", { name: "TRB-OPEN01" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Block customer" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Auto-renew of her subscriptions switches off");
    expect(dialog).toHaveTextContent("She is not notified.");
    // The open ones, with links; the finished booking is not listed.
    expect(within(dialog).getByRole("link", { name: "TRB-OPEN01" })).toHaveAttribute("href", "/admin/bookings/90");
    expect(within(dialog).getByRole("link", { name: "TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(dialog).queryByText("TRB-DONE01")).toBeNull();
    // No reason: nothing is sent.
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(await within(dialog).findByText("Write the reason.")).toBeInTheDocument();
    expect(api.blockCustomer).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "ab");
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(await within(dialog).findByText("The reason needs at least 3 characters.")).toBeInTheDocument();

    api.blockCustomer.mockResolvedValue(blockedCustomer({ version: 3 }));
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "c Abuse");
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    await waitFor(() => expect(api.blockCustomer).toHaveBeenCalledWith(CUSTOMER_ULID, "abc Abuse", 2));
    // The answer is the whole profile: the page shows it blocked without another read.
    expect(await screen.findByText("Customer blocked", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText("Customer blocked", { selector: "div" })).toBeInTheDocument();
  });

  it("does not send a refused version again: it reads the profile, says so, and confirms with the new version", async () => {
    open();
    await screen.findByRole("heading", { level: 1, name: "Sara Ahmed" });
    await userEvent.click(screen.getByRole("button", { name: "Block customer" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Abuse of staff");
    api.blockCustomer.mockRejectedValueOnce(staleError());
    api.fetchCustomer.mockResolvedValue(customerDetail({ version: 3 }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(await within(dialog).findByText("The customer changed")).toBeInTheDocument();
    expect(api.blockCustomer).toHaveBeenCalledTimes(1);
    expect(api.blockCustomer.mock.calls[0][2]).toBe(2);
    await waitFor(() => expect(within(dialog).getByText(/The customer was read again/)).toBeInTheDocument());
    api.blockCustomer.mockResolvedValue(blockedCustomer({ version: 4 }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    await waitFor(() => expect(api.blockCustomer).toHaveBeenCalledTimes(2));
    expect(api.blockCustomer.mock.calls[1][2]).toBe(3);
  });

  it("unblocks with a reason and the version, and says what unblocking does not restore", async () => {
    api.fetchCustomer.mockResolvedValue(blockedCustomer({ version: 5 }));
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Unblock" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Auto-renew stays off: only she can switch it back on.");
    api.unblockCustomer.mockResolvedValue(customerDetail({ version: 6 }));
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Apologised, verified by phone");
    await userEvent.click(within(dialog).getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(api.unblockCustomer).toHaveBeenCalledWith(CUSTOMER_ULID, "Apologised, verified by phone", 5));
    expect(await screen.findByRole("button", { name: "Block customer" })).toBeInTheDocument();
  });

  it("shows the API's refusal in words when the customer's status does not allow it", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Block customer" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Abuse of staff");
    api.blockCustomer.mockRejectedValue(new AdminApiError(409, { code: "INVALID_STATE", message: "", details: { status: "pending_deletion" } }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Block customer" }));
    expect(await within(dialog).findByText("The customer's account is waiting to be deleted, so this cannot be done.")).toBeInTheDocument();
  });
});

describe("deletion and deleted accounts", () => {
  it("shows a deletion waiting out its cooling-off: the day it runs and what it waits on", async () => {
    api.fetchCustomer.mockResolvedValue(
      customerDetail({
        status: "pending_deletion",
        status_label: { ar: "الحذف قيد الانتظار", en: "Deletion pending" },
        deletion: { request_id: 21, scheduled_for: "2026-11-23T05:00:00+00:00", waiting_on: ["refund_processing", "wallet_balance"] },
      }),
    );
    open();
    const banner = (await screen.findByText("Account deletion pending")).closest("[role]")!;
    expect(banner).toHaveTextContent("The deletion runs on");
    expect(banner).toHaveTextContent("Waiting on: a refund in progress, a balance on the account");
  });

  it("reads a deleted account as read-only and anonymous: no name, no actions, no notes, no lists", async () => {
    api.fetchCustomer.mockResolvedValue(
      customerDetail({
        name: null,
        phone: null,
        email: null,
        status: "deleted",
        status_label: { ar: "محذوف", en: "Deleted" },
        addresses: [],
        actions: { block: false, unblock: false, add_note: false, block_address: false, privacy_request: false, marketing_opt_out: false },
      }),
    );
    open();
    expect(await screen.findByRole("heading", { level: 1, name: "Deleted customer" })).toBeInTheDocument();
    expect(screen.getByText("Deleted account")).toBeInTheDocument();
    expect(screen.getByText("A deleted account keeps no notes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block customer" })).toBeNull();
    expect(screen.queryByLabelText("Add a note")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Payments" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Balance" })).toBeNull();
    expect(api.fetchLinked).not.toHaveBeenCalled();
    expect(api.fetchCustomerNotes).not.toHaveBeenCalled();
    expect(finance.fetchCustomerWallet).not.toHaveBeenCalled();
  });
});

describe("addresses", () => {
  it("blocks an address with a reason and the address's own version, and unblocks a blocked one", async () => {
    open();
    const home = (await screen.findByRole("button", { name: "Block Home" })).closest("li")!;
    const office = screen.getByRole("button", { name: "Unblock Office" }).closest("li")!;
    expect(within(office).getByText(/Blocked: Aggressive guard/)).toBeInTheDocument();
    await userEvent.click(within(home).getByRole("button", { name: "Block Home" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Auto-renew of the subscriptions there switches off");
    api.blockAddress.mockResolvedValue({});
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Tenant refuses entry");
    await userEvent.click(within(dialog).getByRole("button", { name: "Block address" }));
    await waitFor(() => expect(api.blockAddress).toHaveBeenCalledWith("01JA0000000000000000000001", "Tenant refuses entry", 4));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await userEvent.click(within(office).getByRole("button", { name: "Unblock Office" }));
    const second = await screen.findByRole("alertdialog");
    api.unblockAddress.mockResolvedValue({});
    await userEvent.type(within(second).getByLabelText(/Reason/), "Guard changed");
    await userEvent.click(within(second).getByRole("button", { name: "Unblock address" }));
    await waitFor(() => expect(api.unblockAddress).toHaveBeenCalledWith("01JA0000000000000000000002", "Guard changed", 2));
  });

  it("offers no address block once the account's erasure has started (the API sets the flag false)", async () => {
    api.fetchCustomer.mockResolvedValue(customerDetail({ actions: { ...customerDetail().actions, block_address: false } }));
    open();
    await screen.findByText("Home");
    expect(screen.queryByRole("button", { name: "Block Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unblock Office" })).toBeNull();
  });
});

describe("privacy tab", () => {
  const openPrivacy = async (permissions: readonly string[] = COORDINATOR) => {
    open(permissions);
    await userEvent.click(await screen.findByRole("tab", { name: "Privacy" }));
  };

  it("shows her consents against the current legal versions and her latest requests", async () => {
    await openPrivacy();
    const consents = (await screen.findByRole("heading", { name: "Consents and contact" })).closest("section")!;
    expect(consents).toHaveTextContent("Marketing messagesNot agreed");
    expect(consents).toHaveTextContent("Usage analyticsAgreed");
    expect(consents).toHaveTextContent("Terms accepted2026-10Current version");
    expect(consents).toHaveTextContent("Privacy policy accepted2026-09Current is 2026-10");
    expect(consents).toHaveTextContent("Saved cards2");
    expect(consents).toHaveTextContent("Not verified");
    const requests = screen.getByRole("heading", { name: "Privacy requests" }).closest("section")!;
    expect(requests).toHaveTextContent("Data copy");
    expect(requests).toHaveTextContent("Completed");
    expect(within(requests).getByRole("link", { name: "Open in the privacy queue" })).toHaveAttribute("href", `/admin/customers/privacy-requests?q=${CUSTOMER_ULID}&status=all`);
  });

  it("records a marketing opt-out with the customer's words", async () => {
    await openPrivacy();
    await userEvent.click(await screen.findByRole("button", { name: "Record marketing opt-out" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record opt-out" }));
    expect(await within(dialog).findByText("Write the reason.")).toBeInTheDocument();
    expect(api.optOutMarketing).not.toHaveBeenCalled();
    api.optOutMarketing.mockResolvedValue(customerDetail());
    await userEvent.type(within(dialog).getByLabelText(/What the customer said/), "Asked on the phone to stop offers");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record opt-out" }));
    await waitFor(() => expect(api.optOutMarketing).toHaveBeenCalledWith(CUSTOMER_ULID, "Asked on the phone to stop offers"));
    expect(await screen.findByText("Marketing opt-out recorded")).toBeInTheDocument();
  });

  it("says when the customer has already opted out", async () => {
    await openPrivacy();
    await userEvent.click(await screen.findByRole("button", { name: "Record marketing opt-out" }));
    const dialog = await screen.findByRole("alertdialog");
    api.optOutMarketing.mockRejectedValue(new AdminApiError(409, { code: "ALREADY_OPTED_OUT", message: "", details: {} }));
    await userEvent.type(within(dialog).getByLabelText(/What the customer said/), "Asked again");
    await userEvent.click(within(dialog).getByRole("button", { name: "Record opt-out" }));
    expect(await within(dialog).findByText("The customer has already opted out of marketing.")).toBeInTheDocument();
  });

  it("offers the filing buttons only for what the profile's actions allow", async () => {
    api.fetchCustomer.mockResolvedValue(customerDetail({ actions: { ...customerDetail().actions, privacy_request: false, marketing_opt_out: false } }));
    await openPrivacy(["customers.view"]);
    await screen.findByRole("heading", { name: "Privacy requests" });
    expect(screen.queryByRole("button", { name: "New privacy request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record marketing opt-out" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in the privacy queue" })).toBeNull();
  });
});

describe("filing a privacy request for her", () => {
  const openDialog = async () => {
    open();
    await userEvent.click(await screen.findByRole("tab", { name: "Privacy" }));
    await userEvent.click(await screen.findByRole("button", { name: "New privacy request" }));
    return screen.findByRole("dialog");
  };

  it("proves a data copy by a code sent to the registered phone and read back, then files it", async () => {
    const dialog = await openDialog();
    api.sendPrivacyOtp.mockResolvedValue({ phone_masked: "+971•••••1234", expires_in: 300, resend_in: 30 });
    api.createPrivacyRequest.mockResolvedValue({ id: 30 });
    // Without a code sent for this request nothing is filed.
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    expect(await within(dialog).findByText("Send a code for this request first, then enter the code she reads back.")).toBeInTheDocument();
    expect(api.createPrivacyRequest).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    expect(api.sendPrivacyOtp).toHaveBeenCalledWith(CUSTOMER_ULID, "export");
    const sent = await within(dialog).findByText((_, el) => el?.tagName === "P" && el.textContent === "A code was sent to +971•••••1234.");
    // The masked number is its own left-to-right run inside the sentence.
    expect(within(sent).getByText("+971•••••1234").tagName).toBe("BDI");
    expect(within(sent).getByText("+971•••••1234")).toHaveAttribute("dir", "ltr");
    expect(within(dialog).getByText(/A new code can be sent in 30 s/)).toBeInTheDocument();
    // Once sent, an empty code is the usual "enter it".
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    expect(await within(dialog).findByText("Enter the code she read back.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "482913");
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    await waitFor(() => expect(api.createPrivacyRequest).toHaveBeenCalledWith(CUSTOMER_ULID, { type: "export", verification: "registered_phone_call", otp_code: "482913" }));
    expect(await screen.findByText("Data copy request filed")).toBeInTheDocument();
  });

  it("never files a deletion on a code the customer was told was for a copy of her data", async () => {
    const dialog = await openDialog();
    api.sendPrivacyOtp.mockResolvedValue({ phone_masked: "+971•••••1234", expires_in: 300, resend_in: 30 });
    api.fetchDeletionImpact.mockResolvedValue({ can_request: true, grace_days: 7, executes_after: "2026-11-26", bookings: [], subscriptions: [], blocking: [] });
    api.createPrivacyRequest.mockResolvedValue({ id: 33 });
    // The code goes out with the data-copy wording, and the caller reads it back...
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    expect(api.sendPrivacyOtp).toHaveBeenLastCalledWith(CUSTOMER_ULID, "export");
    await within(dialog).findByText(/A code was sent to/);
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "482913");
    // ...then the request becomes a deletion: the code is gone, and so is the line saying one was sent.
    await userEvent.selectOptions(within(dialog).getByLabelText("What she asked for"), "delete");
    await within(dialog).findByText(/signed out everywhere/);
    expect(within(dialog).getByLabelText(/Code she read back/)).toHaveValue("");
    expect(within(dialog).queryByText(/A code was sent to/)).toBeNull();
    expect(within(dialog).getByText("The request changed, so the earlier code no longer counts. Send a new code for this request.")).toBeInTheDocument();
    // Typing the old code back in proves nothing: no code was sent for a deletion.
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "482913");
    await userEvent.click(within(dialog).getByRole("button", { name: "File deletion request" }));
    expect(await within(dialog).findByText("Send a code for this request first, then enter the code she reads back.")).toBeInTheDocument();
    expect(api.createPrivacyRequest).not.toHaveBeenCalled();
    // The API's cooldown is per phone, so the countdown keeps running; once over, a code is sent with the deletion wording.
    expect(within(dialog).getByRole("button", { name: "Send code" })).toBeDisabled();
    expect(within(dialog).getByText(/A new code can be sent in \d+ s/)).toBeInTheDocument();
  });

  it("files a deletion once a code was sent for the deletion itself", async () => {
    const dialog = await openDialog();
    api.sendPrivacyOtp.mockResolvedValue({ phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 });
    api.fetchDeletionImpact.mockResolvedValue({ can_request: true, grace_days: 7, executes_after: "2026-11-26", bookings: [], subscriptions: [], blocking: [] });
    api.createPrivacyRequest.mockResolvedValue({ id: 34 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByText(/A code was sent to/);
    await userEvent.selectOptions(within(dialog).getByLabelText("What she asked for"), "delete");
    await within(dialog).findByText(/signed out everywhere/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(api.sendPrivacyOtp).toHaveBeenLastCalledWith(CUSTOMER_ULID, "delete"));
    await within(dialog).findByText(/A code was sent to/);
    expect(within(dialog).queryByText(/The request changed/)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "715204");
    await userEvent.click(within(dialog).getByRole("button", { name: "File deletion request" }));
    await waitFor(() => expect(api.createPrivacyRequest).toHaveBeenCalledWith(CUSTOMER_ULID, { type: "delete", verification: "registered_phone_call", otp_code: "715204" }));
    expect(api.sendPrivacyOtp.mock.calls.map((c) => c[1])).toEqual(["export", "delete"]);
  });

  it("drops the code when the way she proved it changes too", async () => {
    const dialog = await openDialog();
    api.sendPrivacyOtp.mockResolvedValue({ phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByText(/A code was sent to/);
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "482913");
    await userEvent.selectOptions(within(dialog).getByLabelText("How she proved who she is"), "in_person");
    await userEvent.selectOptions(within(dialog).getByLabelText("How she proved who she is"), "registered_phone_call");
    expect(within(dialog).getByLabelText(/Code she read back/)).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("proves a visit by the reference of the document, 10 characters or more", async () => {
    const dialog = await openDialog();
    await userEvent.selectOptions(within(dialog).getByLabelText("How she proved who she is"), "in_person");
    expect(within(dialog).queryByRole("button", { name: "Send code" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    expect(await within(dialog).findByText("Write the reference of the document.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Document reference/), "ID 4321");
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    expect(await within(dialog).findByText("The reference needs at least 10 characters.")).toBeInTheDocument();
    api.createPrivacyRequest.mockResolvedValue({ id: 31 });
    await userEvent.type(within(dialog).getByLabelText(/Document reference/), "!!! Emirates ID ending 4321");
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    await waitFor(() => expect(api.createPrivacyRequest).toHaveBeenCalledWith(CUSTOMER_ULID, { type: "export", verification: "in_person", verification_note: "ID 4321!!! Emirates ID ending 4321" }));
  });

  it("refuses a deletion while items are open, with links, and files it once nothing is open", async () => {
    const dialog = await openDialog();
    api.fetchDeletionImpact.mockResolvedValue({
      can_request: false,
      grace_days: 7,
      executes_after: null,
      bookings: [{ id: 90, reference: "TRB-OPEN01", status_label: { ar: "مؤكد", en: "Confirmed" } }],
      subscriptions: [{ id: 31, reference: "TRS-7K2M9Q", status_label: { ar: "نشط", en: "Active" } }],
      blocking: [
        { code: "open_booking", type: "booking", id: 90, reference: "TRB-OPEN01", message: { ar: "حجز مفتوح", en: "A booking is still open on this account." } },
        { code: "wallet_balance", type: "wallet", id: null, reference: null, message: { ar: "رصيد", en: "There is a balance on the account." } },
      ],
    });
    await userEvent.selectOptions(within(dialog).getByLabelText("What she asked for"), "delete");
    expect(await within(dialog).findByText("Open bookings and subscriptions")).toBeInTheDocument();
    expect(api.fetchDeletionImpact).toHaveBeenCalledWith(CUSTOMER_ULID);
    expect(within(dialog).getByRole("link", { name: "TRB-OPEN01" })).toHaveAttribute("href", "/admin/bookings/90");
    expect(within(dialog).getByRole("link", { name: "TRS-7K2M9Q" })).toHaveAttribute("href", "/admin/subscriptions/31");
    expect(within(dialog).getByText("There is a balance on the account.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "File deletion request" })).toBeDisabled();
    expect(api.createPrivacyRequest).not.toHaveBeenCalled();
  });

  it("explains a deletion that can be filed, then files it with the proof", async () => {
    const dialog = await openDialog();
    api.fetchDeletionImpact.mockResolvedValue({ can_request: true, grace_days: 7, executes_after: "2026-11-26", bookings: [], subscriptions: [], blocking: [] });
    api.createPrivacyRequest.mockResolvedValue({ id: 32 });
    await userEvent.selectOptions(within(dialog).getByLabelText("What she asked for"), "delete");
    await userEvent.selectOptions(within(dialog).getByLabelText("How she proved who she is"), "written_request");
    expect(await within(dialog).findByText(/signed out everywhere and closed. After 7 days it is erased/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Document reference/), "Signed letter L-2026-77");
    await userEvent.click(within(dialog).getByRole("button", { name: "File deletion request" }));
    await waitFor(() => expect(api.createPrivacyRequest).toHaveBeenCalledWith(CUSTOMER_ULID, { type: "delete", verification: "written_request", verification_note: "Signed letter L-2026-77" }));
    expect(await screen.findByText("Deletion request filed")).toBeInTheDocument();
  });

  it("shows what the API refused: a wrong code in words, and a deletion blocked meanwhile with its items", async () => {
    const dialog = await openDialog();
    api.sendPrivacyOtp.mockResolvedValue({ phone_masked: "+971•••••1234", expires_in: 300, resend_in: 0 });
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByText(/A code was sent to/);
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "000000");
    api.createPrivacyRequest.mockRejectedValueOnce(new AdminApiError(422, { code: "OTP_INVALID", message: "", details: { attempts_left: 2 } }));
    await userEvent.click(within(dialog).getByRole("button", { name: "File data copy request" }));
    expect(await within(dialog).findByText("That code is not right. 2 attempts left.")).toBeInTheDocument();

    api.fetchDeletionImpact.mockResolvedValue({ can_request: true, grace_days: 7, executes_after: null, bookings: [], subscriptions: [], blocking: [] });
    await userEvent.selectOptions(within(dialog).getByLabelText("What she asked for"), "delete");
    await within(dialog).findByText(/signed out everywhere/);
    // The answer about the data copy's code no longer stands once the request changed.
    expect(within(dialog).queryByText("That code is not right. 2 attempts left.")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(api.sendPrivacyOtp).toHaveBeenLastCalledWith(CUSTOMER_ULID, "delete"));
    await within(dialog).findByText(/A code was sent to/);
    await userEvent.type(within(dialog).getByLabelText(/Code she read back/), "111111");
    api.createPrivacyRequest.mockRejectedValueOnce(
      new AdminApiError(409, { code: "DELETION_BLOCKED", message: "", details: { items: [{ code: "open_booking", type: "booking", id: 92, reference: "TRB-NEW002", message: "A booking is still open on this account.", link: { path: "/api/v1/admin/bookings/92" } }] } }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "File deletion request" }));
    expect(await within(dialog).findByText("The deletion cannot be filed yet. See what is open below.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "TRB-NEW002" })).toHaveAttribute("href", "/admin/bookings/92");
  });
});
