import { navMetadata } from "../../../_components/metadata";
import { CreditNotesScreen } from "./CreditNotesScreen";

export const generateMetadata = () => navMetadata("creditNotes");

// A09 credit notes (spec §9.3, §14.3; invoices.manage or payments.view).
export default function CreditNotesPage() {
  return <CreditNotesScreen />;
}
