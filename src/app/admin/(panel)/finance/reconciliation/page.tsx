import { navMetadata } from "../../../_components/metadata";
import { ReconciliationRunsScreen } from "./ReconciliationRunsScreen";

export const generateMetadata = () => navMetadata("reconciliation");

// A09 reconciliation: the provider's settlement reports, one run per report date (spec §10.7; reconciliation.run or payments.view).
export default function ReconciliationPage() {
  return <ReconciliationRunsScreen />;
}
