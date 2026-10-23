import { navMetadata } from "../../../_components/metadata";
import { InvoicesScreen } from "./InvoicesScreen";

export const generateMetadata = () => navMetadata("invoices");

// A09 tax invoices (spec §9.3, §14.3, §17; invoices.manage or payments.view).
export default function InvoicesPage() {
  return <InvoicesScreen />;
}
