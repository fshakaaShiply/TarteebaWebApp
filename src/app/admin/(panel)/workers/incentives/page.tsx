import { navMetadata } from "../../../_components/metadata";
import { IncentivesScreen } from "./IncentivesScreen";

export const generateMetadata = () => navMetadata("incentives");

// A05 monthly incentives: proposals, approvals, adjustments and postings (incentives.approve; workforce §5.6).
export default function IncentivesPage() {
  return <IncentivesScreen />;
}
