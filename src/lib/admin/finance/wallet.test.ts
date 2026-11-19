import { describe, expect, it } from "vitest";
import { WALLET_CREDIT_MAX_FILS, reasonFor, showWalletPanel, walletBody, walletCeiling, walletFormSchema } from "./wallet";

const errors = (type: "credit" | "debit", balance: number, values: { amount: string; note: string }) => {
  const parsed = walletFormSchema(type, balance).safeParse(values);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe("the customer balance adjustment form", () => {
  it("sends the amount as integer fils with the reason that goes with the movement", () => {
    expect(walletBody("credit", { amount: "150.50", note: " Late arrival " })).toEqual({ type: "credit", amount_fils: 15050, reason_code: "goodwill", note: "Late arrival" });
    expect(walletBody("debit", { amount: "20", note: "Credited twice" })).toEqual({ type: "debit", amount_fils: 2000, reason_code: "correction", note: "Credited twice" });
    expect(walletBody("credit", { amount: "0", note: "abc" })).toBeNull();
    expect(reasonFor("credit")).toBe("goodwill");
    expect(reasonFor("debit")).toBe("correction");
  });

  it("limits a credit to the single-credit cap and a debit to the balance", () => {
    expect(walletCeiling("credit", 500)).toBe(WALLET_CREDIT_MAX_FILS);
    expect(walletCeiling("debit", 5000)).toBe(5000);
    expect(errors("credit", 0, { amount: "1000.01", note: "Goodwill" })).toEqual(["amount_over"]);
    expect(errors("credit", 0, { amount: "1000.00", note: "Goodwill" })).toEqual([]);
    expect(errors("debit", 5000, { amount: "50.01", note: "Correction" })).toEqual(["amount_over"]);
    expect(errors("debit", 5000, { amount: "50.00", note: "Correction" })).toEqual([]);
  });

  it("explains an empty, invalid, too precise or zero amount and a missing or too short note", () => {
    expect(errors("credit", 0, { amount: "", note: "Goodwill" })).toEqual(["amount_required"]);
    expect(errors("credit", 0, { amount: "abc", note: "Goodwill" })).toEqual(["amount_invalid"]);
    expect(errors("credit", 0, { amount: "1.234", note: "Goodwill" })).toEqual(["amount_precision"]);
    expect(errors("credit", 0, { amount: "0", note: "Goodwill" })).toEqual(["amount_zero"]);
    expect(errors("credit", 0, { amount: "10", note: "" })).toEqual(["note_required"]);
    expect(errors("credit", 0, { amount: "10", note: "ab" })).toEqual(["note_short"]);
    expect(errors("credit", 0, { amount: "10", note: "x".repeat(501) })).toEqual(["note_long"]);
  });

  it("shows the panel while the balance is on, or while there is still money in it", () => {
    expect(showWalletPanel({ enabled: true, balance_fils: 0 })).toBe(true);
    expect(showWalletPanel({ enabled: false, balance_fils: 100 })).toBe(true);
    expect(showWalletPanel({ enabled: false, balance_fils: 0 })).toBe(false);
    expect(showWalletPanel(null)).toBe(false);
  });
});
