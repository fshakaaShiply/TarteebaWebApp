import { navMetadata } from "../../_components/metadata";
import { FinanceSummaryScreen } from "./FinanceSummaryScreen";

export const generateMetadata = () => navMetadata("finance");

// A09 landing page: the KPI cards of the design's header (GET /admin/finance/summary). Transactions, refunds, invoices,
// credit notes and refused documents have their own pages under /admin/finance.
export default function FinancePage() {
  return <FinanceSummaryScreen />;
}
