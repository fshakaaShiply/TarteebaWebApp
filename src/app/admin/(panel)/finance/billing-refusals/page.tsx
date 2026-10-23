import { navMetadata } from "../../../_components/metadata";
import { BillingRefusalsScreen } from "./BillingRefusalsScreen";

export const generateMetadata = () => navMetadata("billingRefusals");

// A09 tax documents Billing refused to issue, with a retry (invoices.manage or payments.view to read; invoices.manage retries).
export default function BillingRefusalsPage() {
  return <BillingRefusalsScreen />;
}
