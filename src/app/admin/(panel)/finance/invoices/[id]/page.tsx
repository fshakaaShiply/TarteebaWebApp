import { navMetadata } from "../../../../_components/metadata";
import { InvoiceDetailScreen } from "./InvoiceDetailScreen";

export const generateMetadata = () => navMetadata("invoices");

// A09 one tax invoice: supplier, lines, VAT, totals, credit notes, PDF and resend (spec §9.3; invoices.manage or payments.view).
export default async function InvoicePage({ params }: PageProps<"/admin/finance/invoices/[id]">) {
  const { id } = await params;
  return <InvoiceDetailScreen id={id} />;
}
