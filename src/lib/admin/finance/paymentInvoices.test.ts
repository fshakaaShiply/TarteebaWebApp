import { describe, expect, it, vi } from "vitest";
import type { AdminInvoice, Paginated } from "../types";
import { MAX_INVOICE_PAGES, findPaymentInvoices, invoicesFromDate } from "./paymentInvoices";

const invoice = (id: number, paymentId: number) => ({ id, number: `INV-2026-${id}`, payment: { id: paymentId } }) as unknown as AdminInvoice;

const page = (data: AdminInvoice[], current: number, last: number): Paginated<AdminInvoice> => ({
  data,
  meta: { current_page: current, per_page: 100, total: last * 100, last_page: last },
});

describe("the invoices of one payment", () => {
  it("walks past the first page of a customer with many invoices", async () => {
    // 100 newer invoices of other payments first: the old version stopped there and said "no invoice".
    const load = vi.fn(async (n: number) =>
      n === 1 ? page(Array.from({ length: 100 }, (_, i) => invoice(500 - i, 900 + i)), 1, 2) : page([invoice(12, 9), invoice(11, 8)], 2, 2),
    );
    await expect(findPaymentInvoices(9, load)).resolves.toEqual({ invoices: [invoice(12, 9)], complete: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("says when it stopped before the last page instead of claiming there is none", async () => {
    const load = vi.fn(async (n: number) => page([invoice(n, 1)], n, 50));
    await expect(findPaymentInvoices(9, load)).resolves.toEqual({ invoices: [], complete: false });
    expect(load).toHaveBeenCalledTimes(MAX_INVOICE_PAGES);
  });

  it("asks only for invoices issued since the payment was created (a day earlier for the time zone)", () => {
    expect(invoicesFromDate("2026-10-23T17:38:11+00:00")).toBe("2026-10-22");
    expect(invoicesFromDate("2026-10-23T01:00:00+04:00")).toBe("2026-10-21");
    expect(invoicesFromDate("not a date")).toBeUndefined();
    expect(invoicesFromDate(null)).toBeUndefined();
  });
});
