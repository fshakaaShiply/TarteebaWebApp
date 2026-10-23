import { navMetadata } from "../../../../_components/metadata";
import { CreditNoteDetailScreen } from "./CreditNoteDetailScreen";

export const generateMetadata = () => navMetadata("creditNotes");

// A09 one credit note: the invoice it credits, reason, lines, totals and PDF (spec §9.3; invoices.manage or payments.view).
export default async function CreditNotePage({ params }: PageProps<"/admin/finance/credit-notes/[id]">) {
  const { id } = await params;
  return <CreditNoteDetailScreen id={id} />;
}
