import { navMetadata } from "../../../../_components/metadata";
import { IncentiveRulesScreen } from "./IncentiveRulesScreen";

export const generateMetadata = () => navMetadata("incentives");

// A05 incentive rules: the weights, thresholds and amount tiers behind the monthly proposals (incentives.approve).
export default function IncentiveRulesPage() {
  return <IncentiveRulesScreen />;
}
