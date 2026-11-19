import { z } from "zod";
import { parseAedToFils } from "@/lib/money";
import type { components } from "@/lib/api/schema";

/*
 * The customer's balance as staff see it (finance §4.8, A1b §2.3). The balance is switched off for customers by the
 * owner's ruling (R-33): staff tools exist and follow the API. A goodwill credit adds money (only while the balance is
 * on); a correction debit takes it back. Amounts are typed in AED and sent as integer fils; the API checks the limits
 * (credit 1 … 1,000.00, debit up to the balance) and refuses with its own codes.
 */

type S = components["schemas"];
type Both = { ar: string; en: string };

export type WalletSource = S["WalletSource"];
export type WalletType = S["WalletTransactionType"];
export const WALLET_SOURCES = ["refund", "compensation", "goodwill", "promo", "payment", "expiry", "correction"] as const satisfies readonly WalletSource[];
export const WALLET_TYPES = ["credit", "debit"] as const satisfies readonly WalletType[];

/** AdminWalletTxn. */
export type WalletTransaction = {
  id: string;
  type: WalletType;
  source: WalletSource;
  source_label: Both;
  amount_fils: number;
  balance_after_fils: number;
  remaining_fils: number | null;
  expires_at: string | null;
  payment: { id: number; ulid: string } | null;
  refund: { id: number; ulid: string } | null;
  context: { type: string | null; id: number | null; reference: string | null } | null;
  reason_code: string | null;
  note: string | null;
  created_by: { type: "staff" | "customer" | "system"; id: number | null; name: string | null };
  created_at: string | null;
};

export type WalletPage = {
  data: { customer_id: string; currency: string; enabled: boolean; balance_fils: number; expiring_30d_fils: number; transactions: WalletTransaction[] };
  meta: { current_page: number; per_page: number; total: number; last_page: number };
};

export type WalletAdjustBody = { type: WalletType; amount_fils: number; reason_code: "goodwill" | "correction"; note: string };

export const WALLET_NOTE_MIN = 3;
export const WALLET_NOTE_MAX = 500;
/** The API's single-credit cap (config payment.wallet.max_single_credit_fils); the API says the real limit in its 422. */
export const WALLET_CREDIT_MAX_FILS = 100_000;
export const WALLET_DEBIT_MAX_FILS = 100_000_000;

export type WalletFormError = "amount_required" | "amount_invalid" | "amount_precision" | "amount_zero" | "amount_over" | "note_required" | "note_short" | "note_long";
export const WALLET_FORM_ERRORS: readonly WalletFormError[] = [
  "amount_required",
  "amount_invalid",
  "amount_precision",
  "amount_zero",
  "amount_over",
  "note_required",
  "note_short",
  "note_long",
];

export type WalletFormValues = { amount: string; note: string };

/** The reason code that goes with each movement (AdjustWalletRequest). */
export const reasonFor = (type: WalletType): "goodwill" | "correction" => (type === "credit" ? "goodwill" : "correction");

export function walletFormSchema(type: WalletType, balanceFils: number) {
  const ceiling = type === "credit" ? WALLET_CREDIT_MAX_FILS : Math.min(WALLET_DEBIT_MAX_FILS, balanceFils);
  return z.object({
    amount: z.string().superRefine((value, ctx) => {
      const parsed = parseAedToFils(value);
      if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: parsed.error === "empty" ? "amount_required" : parsed.error === "precision" ? "amount_precision" : "amount_invalid" });
      } else if (parsed.fils <= 0) ctx.addIssue({ code: "custom", message: "amount_zero" });
      else if (parsed.fils > ceiling) ctx.addIssue({ code: "custom", message: "amount_over" });
    }),
    note: z.string().superRefine((value, ctx) => {
      const note = value.trim();
      if (note === "") ctx.addIssue({ code: "custom", message: "note_required" });
      else if (note.length < WALLET_NOTE_MIN) ctx.addIssue({ code: "custom", message: "note_short" });
      else if (note.length > WALLET_NOTE_MAX) ctx.addIssue({ code: "custom", message: "note_long" });
    }),
  });
}

export function walletCeiling(type: WalletType, balanceFils: number): number {
  return type === "credit" ? WALLET_CREDIT_MAX_FILS : Math.min(WALLET_DEBIT_MAX_FILS, balanceFils);
}

/** The request body for a valid form, else null. */
export function walletBody(type: WalletType, values: WalletFormValues): WalletAdjustBody | null {
  const parsed = parseAedToFils(values.amount);
  if (!parsed.ok || parsed.fils <= 0) return null;
  return { type, amount_fils: parsed.fils, reason_code: reasonFor(type), note: values.note.trim() };
}

export const initialWalletValues: WalletFormValues = { amount: "", note: "" };

/**
 * The panel is offered when the balance is on, or when there is still a balance to see (a switched-off wallet with money
 * in it): customers §7.1 mounts it only then.
 */
export function showWalletPanel(wallet: { enabled: boolean; balance_fils: number } | null | undefined): boolean {
  return wallet ? wallet.enabled || wallet.balance_fils > 0 : false;
}
