import { navMetadata } from "../../../../_components/metadata";
import { ReconciliationRunScreen } from "./ReconciliationRunScreen";

export const generateMetadata = () => navMetadata("reconciliation");

// A09 one reconciliation run: totals, differences, documents check and resolutions (reconciliation.run or payments.view).
export default async function ReconciliationRunPage({ params }: PageProps<"/admin/finance/reconciliation/[id]">) {
  const { id } = await params;
  return <ReconciliationRunScreen id={id} />;
}
