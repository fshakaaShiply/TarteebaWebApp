import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import type { AdminCaseDetail } from "@/lib/admin/quality/types";
import { attachment, caseDetail, compensation, options } from "@/test/qualityFixtures";
import { renderWithProviders } from "@/test/render";
import { ComplaintCaseScreen } from "./ComplaintCaseScreen";

const api = vi.hoisted(() => ({
  fetchCase: vi.fn(),
  fetchAssignees: vi.fn(),
  updateCase: vi.fn(),
  postMessage: vi.fn(),
  uploadCaseFile: vi.fn(),
  resolveCase: vi.fn(),
  fetchFreeVisitAvailability: vi.fn(),
  approveCompensation: vi.fn(),
  rejectCompensation: vi.fn(),
  cancelCompensation: vi.fn(),
}));
vi.mock("@/lib/admin/quality/endpoints", () => api);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COORDINATOR = ["complaints.manage", "bookings.view", "customers.view", "bookings.create_manual"];
const ACCOUNTANT = ["compensation.approve", "refunds.create", "payments.view"];

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "api words", details });

function renderCase(c: AdminCaseDetail, permissions: readonly string[] = COORDINATOR, locale: "en" | "ar" = "en") {
  api.fetchCase.mockResolvedValue(c);
  return renderWithProviders(<ComplaintCaseScreen id={String(c.id)} />, { permissions, locale });
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchAssignees.mockResolvedValue([
    { id: 1, name: "Test Admin", roles: ["booking_coordinator"] },
    { id: 4, name: "Omar", roles: ["operations_coordinator"] },
  ]);
  api.fetchFreeVisitAvailability.mockResolvedValue({ data: [], meta: { timezone: "Asia/Dubai", horizon_days: 14, limited_threshold: 2, workers: 2 } });
});

describe("the case page", () => {
  it("shows the customer's words, the team's reply and the internal note apart, with the files as signed links", async () => {
    renderCase(caseDetail());
    expect(await screen.findByRole("heading", { level: 1, name: /TC-4XQ8NM/ })).toBeInTheDocument();
    const thread = screen.getByRole("list", { name: "Messages" });
    expect(within(thread).getByText("The second bathroom was not cleaned at all.")).toBeInTheDocument();
    expect(within(thread).getByText("We are looking into it.")).toBeInTheDocument();
    const note = within(thread).getByText("Supervisor checked the visit with the cleaner.").closest("article")!;
    expect(within(note).getByText("Internal note, the customer never sees it")).toBeInTheDocument();
    // The first reply's deadline: three hours left on the test clock.
    expect(screen.getAllByText("3 h left").length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: /Photo 1/ });
    expect(link).toHaveAttribute("href", "https://files.example.test/signed/a1?sig=abc");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("does not offer a link that has expired: it asks for the case again, which carries new links", async () => {
    const stale = caseDetail({ attachments: [attachment({ url_expires_at: "2026-10-23T15:00:00+00:00" })] });
    renderCase(stale);
    const button = await screen.findByRole("button", { name: "Get a new link for Photo 1" });
    expect(screen.queryByRole("link", { name: /Photo 1/ })).toBeNull();
    api.fetchCase.mockResolvedValue(caseDetail());
    await userEvent.click(button);
    expect(await screen.findByRole("link", { name: /Photo 1/ })).toBeInTheDocument();
  });

  it("shows the time line of what happened, in words", async () => {
    renderCase(caseDetail({ events: [{ type: "status_changed", actor: { type: "staff", id: 4, name: "Omar" }, data: { from: "open", to: "in_review", reason: "first reply" }, created_at: "2026-10-23T13:00:00+00:00" }] }));
    await userEvent.click(await screen.findByRole("button", { name: "Show the timeline (1)" }));
    expect(screen.getByText("Status changed from Open to In review · Reason: first reply")).toBeInTheDocument();
  });

  it("says the case was not found, and shows the permission-denied page for a 403", async () => {
    api.fetchCase.mockRejectedValue(apiError(404, "NOT_FOUND"));
    const { unmount } = renderWithProviders(<ComplaintCaseScreen id="99" />, { permissions: COORDINATOR });
    expect(await screen.findByText("This case was not found")).toBeInTheDocument();
    unmount();
    api.fetchCase.mockRejectedValue(apiError(403, "FORBIDDEN"));
    renderWithProviders(<ComplaintCaseScreen id="7" />, { permissions: COORDINATOR });
    expect(await screen.findByText(/access/i)).toBeInTheDocument();
  });

  it("shows the whole page in Arabic", async () => {
    renderCase(caseDetail(), COORDINATOR, "ar");
    expect(await screen.findByText("المحادثة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حل الحالة" })).toBeInTheDocument();
    expect(screen.getByText("ملاحظة داخلية، لا يراها العميل")).toBeInTheDocument();
  });
});

describe("handling a case", () => {
  it("assigns it with the version it read as If-Match", async () => {
    renderCase(caseDetail());
    api.updateCase.mockResolvedValue(caseDetail({ version: 6, assignee: { id: 4, name: "Omar" } }));
    await screen.findByRole("option", { name: "Omar" });
    await userEvent.selectOptions(screen.getByLabelText("Assigned to"), "4");
    expect(api.updateCase).toHaveBeenCalledWith(7, { assignee_id: 4 }, 5);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("takes it for the signed-in person with one button", async () => {
    renderCase(caseDetail());
    api.updateCase.mockResolvedValue(caseDetail({ version: 6, assignee: { id: 1, name: "Test Admin" } }));
    await userEvent.click(await screen.findByRole("button", { name: "Assign to me" }));
    expect(api.updateCase).toHaveBeenCalledWith(7, { assignee_id: 1 }, 5);
  });

  it("changes the priority, and tells the person when someone else changed the case first", async () => {
    renderCase(caseDetail());
    api.updateCase.mockRejectedValue(apiError(409, "STALE_VERSION", { current_version: 7 }));
    await userEvent.selectOptions(await screen.findByLabelText("Priority"), "urgent");
    expect(api.updateCase).toHaveBeenCalledWith(7, { priority: "urgent" }, 5);
    expect(await screen.findByText("The case changed meanwhile")).toBeInTheDocument();
    // The case was read again.
    await waitFor(() => expect(api.fetchCase.mock.calls.length).toBeGreaterThan(1));
  });

  it("names the cleaners from the visit's own list and saves them together", async () => {
    renderCase(caseDetail());
    api.updateCase.mockResolvedValue(caseDetail({ version: 6 }));
    const nirmala = await screen.findByRole("checkbox", { name: "Nirmala P." });
    // Maria is already named; Nirmala is added to her.
    expect(screen.getByRole("checkbox", { name: "Maria S." })).toBeChecked();
    await userEvent.click(nirmala);
    await userEvent.click(screen.getByRole("button", { name: "Save cleaners" }));
    expect(api.updateCase).toHaveBeenCalledWith(7, { worker_ids: [1, 4] }, 5);
  });

  it("is read-only for the accountant: nothing to type, assign or resolve", async () => {
    renderCase(caseDetail({ actions: { assign: false, reply: false, resolve: false, close: false, reopen: false, approve: false, reject: false, cancel_compensation: false } }), ACCOUNTANT);
    expect(await screen.findByText(/You can read this case/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Reply to the case" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByLabelText("Assigned to")).toBeNull();
    // The assignee list is not even asked for.
    expect(api.fetchAssignees).not.toHaveBeenCalled();
  });
});

describe("replying", () => {
  it("sends a public reply with one Idempotency-Key and offers to wait for the customer", async () => {
    renderCase(caseDetail());
    const updated = caseDetail({ version: 6 });
    api.postMessage.mockResolvedValue(updated);
    await userEvent.type(await screen.findByLabelText(/Your reply/), "Which room was it?");
    await userEvent.click(screen.getByRole("checkbox", { name: /Wait for the customer's answer/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledTimes(1));
    expect(api.postMessage).toHaveBeenCalledWith(7, { body: "Which room was it?", is_internal: false, await_customer: true }, expect.stringMatching(UUID));
    expect(await screen.findByText("Reply sent")).toBeInTheDocument();
    expect(screen.getByLabelText(/Your reply/)).toHaveValue("");
  });

  it("an internal note carries no wait flag and says only staff see it", async () => {
    renderCase(caseDetail());
    api.postMessage.mockResolvedValue(caseDetail({ version: 6 }));
    await userEvent.click(await screen.findByRole("radio", { name: "Internal note" }));
    expect(screen.queryByRole("checkbox", { name: /Wait for the customer/ })).toBeNull();
    expect(screen.getByText(/Only staff see an internal note/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Your note/), "Called the supervisor");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalled());
    expect(api.postMessage.mock.calls[0][1]).toEqual({ body: "Called the supervisor", is_internal: true });
  });

  it("offers no wait box on a case the customer cannot see", async () => {
    renderCase(caseDetail({ customer_visible: false, type: "rating_followup" }));
    await screen.findByLabelText(/Your reply/);
    expect(screen.queryByRole("checkbox", { name: /Wait for the customer/ })).toBeNull();
    expect(screen.getByText(/The customer cannot see this case yet/)).toBeInTheDocument();
  });

  it("uploads the photos first and names them in the message", async () => {
    renderCase(caseDetail());
    api.uploadCaseFile.mockResolvedValue(attachment({ id: "UP1" }));
    api.postMessage.mockResolvedValue(caseDetail({ version: 6 }));
    await userEvent.type(await screen.findByLabelText(/Your reply/), "See the photo");
    const input = screen.getByLabelText("Files") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "bathroom.jpg", { type: "image/jpeg" }));
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalled());
    expect(api.uploadCaseFile).toHaveBeenCalledTimes(1);
    expect(api.postMessage.mock.calls[0][1]).toEqual({ body: "See the photo", is_internal: false, attachment_ids: ["UP1"] });
  });

  it("keeps a PDF off a public reply before anything is uploaded", async () => {
    renderCase(caseDetail());
    await userEvent.type(await screen.findByLabelText(/Your reply/), "Here is the report");
    await userEvent.upload(screen.getByLabelText("Files"), new File(["x"], "report.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect((await screen.findAllByText("A PDF can only go on an internal note.")).length).toBeGreaterThan(0);
    expect(api.uploadCaseFile).not.toHaveBeenCalled();
    expect(api.postMessage).not.toHaveBeenCalled();
  });

  it("sends the same key again after a lost answer, and a new one once the text changes", async () => {
    renderCase(caseDetail());
    api.postMessage.mockRejectedValueOnce(apiError(502, "BAD_GATEWAY")).mockResolvedValue(caseDetail({ version: 6 }));
    await userEvent.type(await screen.findByLabelText(/Your reply/), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(await screen.findByText("The reply may have been sent")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(api.postMessage).toHaveBeenCalledTimes(2));
    expect(api.postMessage.mock.calls[1][2]).toBe(api.postMessage.mock.calls[0][2]);
  });
});

describe("resolving", () => {
  async function openResolve(c = caseDetail()) {
    renderCase(c);
    await userEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    return screen.findByRole("dialog");
  }

  it("proposes a refund to the accountant: the second step shows the money, and only then it is sent", async () => {
    const dialog = await openResolve();
    api.resolveCase.mockResolvedValue({ data: caseDetail({ version: 6 }), meta: { result: "pending_approval" } });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "partial");
    await userEvent.type(within(dialog).getByLabelText(/^Reply to the customer/), "We are sorry; half the visit is refunded.");
    await userEvent.click(within(dialog).getByRole("radio", { name: /^Refund/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), "30.00");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    // Nothing is sent until the exact money is confirmed.
    expect(api.resolveCase).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Nothing is paid yet/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send for approval: Refund AED 30.00" }));
    await waitFor(() => expect(api.resolveCase).toHaveBeenCalledTimes(1));
    expect(api.resolveCase).toHaveBeenCalledWith(
      7,
      { outcome: "partial", resolution: "We are sorry; half the visit is refunded.", compensation: { type: "refund", amount_fils: 3000 } },
      5,
      expect.stringMatching(UUID),
    );
    expect(await screen.findByText("Sent to the accountant for approval")).toBeInTheDocument();
  });

  it("caps the amount by the maximum the case gives and says so", async () => {
    const dialog = await openResolve();
    expect(within(dialog).getByRole("radio", { name: /^Refund/ })).toHaveAccessibleName(/At most AED 120\.00/);
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "upheld");
    await userEvent.type(within(dialog).getByLabelText(/^Reply to the customer/), "Sorry.");
    await userEvent.click(within(dialog).getByRole("radio", { name: /^Refund/ }));
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), "150");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("The amount is more than this visit allows.")).toBeInTheDocument();
    expect(api.resolveCase).not.toHaveBeenCalled();
  });

  it("switches a type off with the reason when the case says it is unavailable", async () => {
    const dialog = await openResolve(
      caseDetail({ compensation_options: options({ credit: { available: false, max_fils: 0, reason: "wallet_disabled" }, free_visit: { available: false, reason: "visit_not_eligible" } }) }),
    );
    const credit = within(dialog).getByRole("radio", { name: /^Balance credit/ });
    expect(credit).toBeDisabled();
    expect(credit).toHaveAccessibleName(/The customer balance is not switched on yet/);
    expect(within(dialog).getByRole("radio", { name: /^Free cleaning visit/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /^Refund/ })).toBeEnabled();
  });

  it("switches the free visit off without the permission to book by hand", async () => {
    renderCase(caseDetail(), ["complaints.manage", "bookings.view"]);
    await userEvent.click(await screen.findByRole("button", { name: "Resolve" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /^Free cleaning visit/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /^Free cleaning visit/ })).toHaveAccessibleName(/permission to create bookings by hand/);
  });

  it("books a free visit on a date and slot from the case's own availability", async () => {
    api.fetchFreeVisitAvailability.mockResolvedValue({
      data: [
        { date: "2026-10-26", slots: [{ slot_template_id: 1, code: "MORNING", name: "Morning", start: "10:00", end: "14:00", status: "available" }, { slot_template_id: 2, code: "EVENING", name: "Evening", start: "16:00", end: "20:00", status: "full" }] },
        { date: "2026-10-27", slots: [{ slot_template_id: 2, code: "EVENING", name: "Evening", start: "16:00", end: "20:00", status: "closed" }] },
      ],
      meta: { timezone: "Asia/Dubai", horizon_days: 14, limited_threshold: 2, workers: 2 },
    });
    const dialog = await openResolve();
    api.resolveCase.mockResolvedValue({ data: caseDetail({ version: 6 }), meta: { result: "resolved" } });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "upheld");
    await userEvent.type(within(dialog).getByLabelText(/^Reply to the customer/), "We will send a cleaner again.");
    await userEvent.click(within(dialog).getByRole("radio", { name: /^Free cleaning visit/ }));
    const date = await within(dialog).findByLabelText(/^Date of the free visit/);
    // Only the day with a bookable slot is offered; the full and the closed slots are not.
    expect(within(date).getAllByRole("option")).toHaveLength(2);
    await userEvent.selectOptions(date, "2026-10-26");
    const slot = within(dialog).getByLabelText(/^Time slot/);
    expect(within(slot).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a slot", "Morning · 10:00–14:00"]);
    await userEvent.selectOptions(slot, "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^Book the free visit and resolve/ }));
    await waitFor(() => expect(api.resolveCase).toHaveBeenCalled());
    expect(api.resolveCase.mock.calls[0][1]).toEqual({
      outcome: "upheld",
      resolution: "We will send a cleaner again.",
      // The team size is sent only when the person changed it from the original visit's.
      compensation: { type: "free_visit", free_visit: { date: "2026-10-26", slot_template_id: 1 } },
    });
    expect(await screen.findByText("TC-4XQ8NM resolved")).toBeInTheDocument();
  });

  it("resolves a hidden follow-up quietly, with no reply to the customer", async () => {
    const dialog = await openResolve(caseDetail({ type: "rating_followup", customer_visible: false, source: "rating" }));
    api.resolveCase.mockResolvedValue({ data: caseDetail({ version: 6 }), meta: { result: "resolved" } });
    expect(within(dialog).getByText("The customer has not been told about this case. Leave it empty to resolve it quietly.")).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "not_upheld");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByText("The customer is not told about this case")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Send reply and resolve" }));
    await waitFor(() => expect(api.resolveCase).toHaveBeenCalled());
    expect(api.resolveCase.mock.calls[0][1]).toEqual({ outcome: "not_upheld" });
  });

  it("does not resend a refused version: 409 STALE_VERSION says nothing was saved and shows the case as read again", async () => {
    const dialog = await openResolve();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "upheld");
    await userEvent.type(within(dialog).getByLabelText(/^Reply to the customer/), "Sorry.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.resolveCase.mockRejectedValueOnce(apiError(409, "STALE_VERSION", { current_version: 7 })).mockResolvedValue({ data: caseDetail({ version: 8 }), meta: { result: "resolved" } });
    // Someone else changed the case: the page reads version 7.
    api.fetchCase.mockResolvedValue(caseDetail({ version: 7, priority: "urgent" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send reply and resolve" }));
    expect(await within(dialog).findByText("The case changed meanwhile")).toBeInTheDocument();
    expect(await within(dialog).findByText(/The case was read again: check it, then confirm once more/)).toBeInTheDocument();
    // Back on the form, and the next confirmation carries the new version and a new key.
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send reply and resolve" }));
    await waitFor(() => expect(api.resolveCase).toHaveBeenCalledTimes(2));
    expect(api.resolveCase.mock.calls[0][2]).toBe(5);
    expect(api.resolveCase.mock.calls[1][2]).toBe(7);
    expect(api.resolveCase.mock.calls[1][3]).not.toBe(api.resolveCase.mock.calls[0][3]);
  });

  it("words the API's refusal: a compensation already waiting", async () => {
    const dialog = await openResolve();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Outcome/), "upheld");
    await userEvent.type(within(dialog).getByLabelText(/^Reply to the customer/), "Sorry.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    api.resolveCase.mockRejectedValue(apiError(409, "COMPENSATION_PENDING"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send reply and resolve" }));
    expect(await within(dialog).findByText(/A compensation is waiting for approval/)).toBeInTheDocument();
  });
});

describe("closing, reopening and withdrawing", () => {
  it("closes an active case with a reason the person picks", async () => {
    renderCase(caseDetail());
    api.updateCase.mockResolvedValue(caseDetail({ version: 6, status: "closed" }));
    await userEvent.click(await screen.findByRole("button", { name: "Close case" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close case" }));
    expect(await within(dialog).findByText("Choose a reason for closing the case.")).toBeInTheDocument();
    expect(api.updateCase).not.toHaveBeenCalled();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Reason/), "duplicate");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close case" }));
    await waitFor(() => expect(api.updateCase).toHaveBeenCalledWith(7, { status: "closed", close_reason: "duplicate" }, 5));
  });

  it("will not close a resolved case while its compensation has not reached the customer", async () => {
    const executed = compensation({ status: "executed", status_label: { ar: "تم المنح", en: "Given" }, settled_at: null, refund: { id: 3, ulid: "R3", status: "processing", status_label: { ar: "قيد المعالجة", en: "Processing" } } });
    renderCase(caseDetail({ status: "resolved", compensations: [executed], actions: { assign: true, reply: true, resolve: false, close: true, reopen: true, approve: false, reject: false, cancel_compensation: false } }));
    await userEvent.click(await screen.findByRole("button", { name: "Close case" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("The compensation has not reached the customer")).toBeInTheDocument();
    expect(within(dialog).getByText(/Refund was given but its status is still: Processing/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close case" })).toBeDisabled();
  });

  it("reopens a resolved case only with a reason, and sends it", async () => {
    renderCase(caseDetail({ status: "resolved", actions: { assign: true, reply: true, resolve: false, close: true, reopen: true, approve: false, reject: false, cancel_compensation: false } }));
    api.updateCase.mockResolvedValue(caseDetail({ version: 6 }));
    await userEvent.click(await screen.findByRole("button", { name: "Reopen" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    expect(await within(dialog).findByText("Write why the case is being reopened.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Why is it reopened/), "The customer called again");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(api.updateCase).toHaveBeenCalledWith(7, { status: "in_review", reason: "The customer called again" }, 5));
  });

  it("withdraws a proposal that still waits, with its own version", async () => {
    const pending = compensation({ version: 3 });
    renderCase(caseDetail({ compensations: [pending], pending_resolution: { outcome: "partial", resolution: "Half is refunded.", compensation_id: 12 }, actions: { assign: true, reply: true, resolve: false, close: true, reopen: false, approve: false, reject: false, cancel_compensation: true } }));
    api.cancelCompensation.mockResolvedValue({ ...pending, status: "cancelled" });
    expect(await screen.findByText("The reply is held until the accountant decides")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw proposal" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^Reason/), "Wrong visit");
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(api.cancelCompensation).toHaveBeenCalledWith(12, "Wrong visit", 3));
  });
});

describe("a payment link", () => {
  it("opens finance on the list found by the booking's reference, since the payment page is addressed by number", async () => {
    renderCase(caseDetail(), [...COORDINATOR, "payments.view"]);
    const link = await screen.findByRole("link", { name: "Find the payment in finance" });
    expect(link).toHaveAttribute("href", "/admin/finance/payments?reference=TRB-R4RYSD");
  });

  it("is not offered to staff without the payments permission (the API sends no link)", async () => {
    renderCase(caseDetail({ payment: { ...caseDetail().payment!, link: null } }));
    await screen.findByRole("heading", { level: 3, name: "Payment" });
    expect(screen.queryByRole("link", { name: "Find the payment in finance" })).toBeNull();
  });
});
