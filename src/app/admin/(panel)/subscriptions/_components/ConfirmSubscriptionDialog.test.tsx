import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { renderWithProviders } from "@/test/render";
import { candidate, liveOutDetail, pendingDetail } from "@/test/subscriptionFixtures";
import { ConfirmSubscriptionDialog } from "./ConfirmSubscriptionDialog";

const api = vi.hoisted(() => {
  const names = ["previewConfirm", "confirmSubscription", "fetchWorkerCandidates"];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>;
});
vi.mock("@/lib/admin/subscriptions/endpoints", () => api);

const apiError = (status: number, code: string, details: Record<string, unknown> = {}) => new AdminApiError(status, { code, message: "", details });
const preview = (over: Record<string, unknown> = {}) => ({
  primary: { worker_id: 14, fits: 6, of: 8, unfit: [{ date: "2026-11-01", reasons: ["rest_day"] }, { date: "2026-11-08", reasons: ["leave"] }] },
  backup: null,
  started: [],
  payment: { status: "authorized", amount_fils: 96000 },
  ...over,
});

/** Waits for the candidates to load, then chooses one. */
async function pick(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const select = await screen.findByLabelText(label);
  await waitFor(() => expect(within(select).getByRole("option", { name: new RegExp(`^${value === "14" ? "Maria" : "Rosa"}`) })).toBeInTheDocument());
  await user.selectOptions(select, value);
}

function setup(subscription = pendingDetail()) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(<ConfirmSubscriptionDialog subscription={subscription} onClose={onClose} onStale={onStale} />, { permissions: ["subscriptions.manage"] });
  return { onClose, onStale, user: userEvent.setup() };
}

describe("A08 confirm dialog", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchWorkerCandidates.mockImplementation(async (_id: number, role: string) => (role === "primary" ? [candidate(14, "Maria S.", { fits: 6, of: 8 }), candidate(16, "Joy R.")] : [candidate(15, "Rosa")]));
    api.previewConfirm.mockResolvedValue(preview());
  });

  it("shows the payment, who can cover which days and the dates that start before confirmation", async () => {
    api.previewConfirm.mockResolvedValue(preview({ started: [{ date: "2026-10-31" }], backup: null }));
    const { user } = setup();
    await pick(user, "Primary worker", "14");
    expect(await screen.findByText(/Primary worker · fits 6 of 8 visits/)).toBeInTheDocument();
    expect(screen.getByText("Weekly rest day")).toBeInTheDocument();
    expect(screen.getByText("On leave")).toBeInTheDocument();
    expect(screen.getByText("AED 960.00")).toBeInTheDocument();
    expect(screen.getByText("Held on the card")).toBeInTheDocument();
    expect(screen.getByText("Visits already started before confirmation: 1")).toBeInTheDocument();
    expect(api.previewConfirm).toHaveBeenLastCalledWith(31, { primary_worker_id: 14 });
  });

  it("needs a primary worker for a Live-out contract and sends nothing without one", async () => {
    const { user } = setup(liveOutDetail({ status: "pending_confirmation", workers: { primary: null, backup: null }, actions: { ...liveOutDetail().actions, confirm: true } }));
    await screen.findByLabelText("Primary worker (required)", { exact: false });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("A Live-out contract needs a primary worker.")).toBeInTheDocument();
    expect(api.confirmSubscription).not.toHaveBeenCalled();
  });

  it("confirms with the chosen workers, the version as If-Match and one idempotency key, then closes", async () => {
    api.confirmSubscription.mockResolvedValue(pendingDetail({ status: "active" }));
    const { user, onClose } = setup();
    await pick(user, "Primary worker", "14");
    await pick(user, "Backup worker", "15");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.confirmSubscription).toHaveBeenCalledTimes(1);
    const [id, body, version, key] = api.confirmSubscription.mock.calls[0];
    expect([id, body, version]).toEqual([31, { primary_worker_id: 14, backup_worker_id: 15 }, 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the customer's choice when staff name nobody", async () => {
    api.confirmSubscription.mockResolvedValue(pendingDetail());
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.confirmSubscription).toHaveBeenCalled());
    expect(api.confirmSubscription.mock.calls[0][1]).toEqual({});
  });

  it("answers 502 PAYMENT_RESULT_UNKNOWN with 'capture result unknown, confirm again' and the same key on the retry", async () => {
    api.confirmSubscription.mockRejectedValueOnce(apiError(502, "PAYMENT_RESULT_UNKNOWN")).mockResolvedValue(pendingDetail({ status: "active" }));
    const { user, onClose } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Capture result unknown")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm again" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.confirmSubscription.mock.calls[1][3]).toBe(api.confirmSubscription.mock.calls[0][3]);
  });

  it("names the dates whose capacity is no longer held", async () => {
    api.confirmSubscription.mockRejectedValue(apiError(409, "CAPACITY_NOT_HELD", { dates: ["2026-11-01", "2026-11-04"] }));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    const box = (await screen.findByText("Capacity is no longer held for these dates")).closest("div") as HTMLElement;
    expect(within(box).getByText("Sun, 1 Nov 2026")).toBeInTheDocument();
    expect(within(box).getByText("Wed, 4 Nov 2026")).toBeInTheDocument();
  });

  it("disables the buttons while sending, and hands a stale version back to the page", async () => {
    let reject: (e: unknown) => void = () => undefined;
    api.confirmSubscription.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { user, onStale, onClose } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    reject(apiError(409, "STALE_VERSION", { current_version: 8 }));
    await waitFor(() => expect(onStale).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("says the subscription changed while the dialog was open", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ConfirmSubscriptionDialog subscription={pendingDetail()} onClose={onClose} onStale={vi.fn()} changed />, { permissions: ["subscriptions.manage"] });
    expect(await screen.findByText("This subscription changed")).toBeInTheDocument();
  });
});
