import type { AdminInvoice, Paginated } from "../types";

/*
 * The tax invoices of one payment. GET /admin/invoices has no payment filter (requested from the API), so the
 * payment page reads the customer's invoices issued since the payment was created (newest first, 100 a page) and
 * keeps this payment's. An invoice is issued when the payment is taken (Billing IssueInvoiceForPayment: issue_date is
 * the local date then), never before the payment existed, so nothing older is needed. The walk stops after
 * MAX_INVOICE_PAGES; if pages remain, the result says so instead of claiming there is no invoice.
 */

export const INVOICE_PAGE_SIZE = 100;
export const MAX_INVOICE_PAGES = 10;

export type PaymentInvoices = { invoices: AdminInvoice[]; complete: boolean };

/**
 * The earliest issue date to ask for: the payment's creation date in UTC, a day earlier, so the business time zone
 * (UTC+4) can never put the invoice's local date before it.
 */
export function invoicesFromDate(createdAt: string | null | undefined): string | undefined {
  if (!createdAt) return undefined;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return undefined;
  return new Date(at - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function findPaymentInvoices(paymentId: number, load: (page: number) => Promise<Paginated<AdminInvoice>>): Promise<PaymentInvoices> {
  const invoices: AdminInvoice[] = [];
  for (let page = 1; page <= MAX_INVOICE_PAGES; page++) {
    const result = await load(page);
    invoices.push(...result.data.filter((invoice) => invoice.payment.id === paymentId));
    if (page >= result.meta.last_page) return { invoices, complete: true };
  }
  return { invoices, complete: false };
}
