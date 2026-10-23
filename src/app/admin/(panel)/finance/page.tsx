import { redirect } from "next/navigation";

// A09 has no page of its own: the transactions table is its first page (refunds, invoices, credit notes and refused
// documents have their own pages under /admin/finance).
export default function FinancePage() {
  redirect("/admin/finance/payments");
}
