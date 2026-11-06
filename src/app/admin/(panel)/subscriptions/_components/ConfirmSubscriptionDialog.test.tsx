import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin/client";
import { isolate } from "@/lib/admin/format";
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
  // The option starts with the name as its own bidi run (U+2068 … U+2069).
  await waitFor(() => expect(within(select).getByRole("option", { name: new RegExp(`^⁨${value === "14" ? "Maria" : "Rosa"}`) })).toBeInTheDocument());
  await user.selectOptions(select, value);
}

function setup(subscription = pendingDetail()) {
  const onClose = vi.fn();
  const onStale = vi.fn();
  renderWithProviders(<ConfirmSubscriptionDialog subscription={subscription} onClose={onClose} onStale={onStale} />, { permissions: ["subscriptions.manage"] });
  return { onClose, onStale, user: userEvent.setup() };
}

/** Confirm is pressed once the preview (the amount to capture) is on screen. */
async function confirmAfterPreview(user: ReturnType<typeof userEvent.setup>, name = "Confirm") {
  await screen.findByText("AED 960.00");
  await user.click(screen.getByRole("button", { name }));
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
    await waitFor(() => expect(api.previewConfirm).toHaveBeenLastCalledWith(31, { primary_worker_id: 14, backup_worker_id: 15 }));
    await confirmAfterPreview(user);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.confirmSubscription).toHaveBeenCalledTimes(1);
    const [id, body, version, key] = api.confirmSubscription.mock.calls[0];
    expect([id, body, version]).toEqual([31, { primary_worker_id: 14, backup_worker_id: 15 }, 7]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the customer's choice when staff name nobody", async () => {
    api.confirmSubscription.mockResolvedValue(pendingDetail());
    const { user } = setup();
    await confirmAfterPreview(user);
    await waitFor(() => expect(api.confirmSubscription).toHaveBeenCalled());
    expect(api.confirmSubscription.mock.calls[0][1]).toEqual({});
  });

  it("captures nothing before its preview is on screen", async () => {
    api.previewConfirm.mockReturnValue(new Promise(() => undefined));
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Wait for the preview before confirming. If it could not be loaded, try it again.")).toBeInTheDocument();
    expect(api.confirmSubscription).not.toHaveBeenCalled();
  });

  it("captures nothing when the preview failed", async () => {
    api.previewConfirm.mockRejectedValue(apiError(500, "SERVER_ERROR"));
    const { user } = setup();
    await screen.findByRole("button", { name: "Try again" });
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    const notice = await screen.findByText(/Wait for the preview before confirming/);
    expect(notice.closest("[role=alert]")).not.toBeNull();
    expect(api.confirmSubscription).not.toHaveBeenCalled();
  });

  it("names a refused worker by the role and name the API gives (P4-242), not by database id", async () => {
    api.confirmSubscription.mockRejectedValue(
      apiError(422, "WORKER_NOT_ASSIGNABLE", { workers: [{ worker_id: 15, name: "Rosa", role: "backup", reason: "not_eligible", reasons: ["not_eligible"] }] }),
    );
    const { user } = setup();
    await pick(user, "Backup worker", "15");
    await waitFor(() => expect(api.previewConfirm).toHaveBeenLastCalledWith(31, { backup_worker_id: 15 }));
    await confirmAfterPreview(user);
    expect(await screen.findByText(`Backup worker: ${isolate("Rosa")} · Not eligible for this service`)).toBeInTheDocument();
    expect(screen.queryByText(/^15 ·/)).not.toBeInTheDocument();
  });

  it("names refused workers from the preview's own answer, also one no candidate list holds, and her number only without a name", async () => {
    api.previewConfirm.mockRejectedValue(
      apiError(422, "WORKER_NOT_ASSIGNABLE", {
        workers: [
          { worker_id: 31, name: "Ana P.", role: "primary", reason: "not_eligible", reasons: ["not_eligible"] },
          { worker_id: 77, name: null, role: "backup", reason: "not_active", reasons: [] },
        ],
      }),
    );
    setup();
    // A name is its own bidi run ("Ana P." keeps its period before " · " in Arabic); the number without a name is plain.
    expect(await screen.findByText(`Primary worker: ${isolate("Ana P.")} · Not eligible for this service`)).toBeInTheDocument();
    expect(screen.getByText("Backup worker: worker no. 77 · Not an active worker")).toBeInTheDocument();
  });

  it("answers 502 PAYMENT_RESULT_UNKNOWN with 'capture result unknown, confirm again' and the same key on the retry", async () => {
    api.confirmSubscription.mockRejectedValueOnce(apiError(502, "PAYMENT_RESULT_UNKNOWN")).mockResolvedValue(pendingDetail({ status: "active" }));
    const { user, onClose } = setup();
    await confirmAfterPreview(user);
    expect(await screen.findByText("Capture result unknown")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm again" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.confirmSubscription.mock.calls[1][3]).toBe(api.confirmSubscription.mock.calls[0][3]);
  });

  it("names the dates whose capacity is no longer held", async () => {
    api.confirmSubscription.mockRejectedValue(apiError(409, "CAPACITY_NOT_HELD", { dates: ["2026-11-01", "2026-11-04"] }));
    const { user } = setup();
    await confirmAfterPreview(user);
    const box = (await screen.findByText("Capacity is no longer held for these dates")).closest("div") as HTMLElement;
    expect(within(box).getByText("Sun, 1 Nov 2026")).toBeInTheDocument();
    expect(within(box).getByText("Wed, 4 Nov 2026")).toBeInTheDocument();
  });

  it("disables the buttons while sending, and hands a stale version back to the page", async () => {
    let reject: (e: unknown) => void = () => undefined;
    api.confirmSubscription.mockReturnValue(new Promise((_, r) => (reject = r)));
    const { user, onStale, onClose } = setup();
    await confirmAfterPreview(user);
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
