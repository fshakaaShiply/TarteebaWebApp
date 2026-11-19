import { navMetadata } from "../../../_components/metadata";
import { CompensationsScreen } from "./CompensationsScreen";

export const generateMetadata = () => navMetadata("qualityCompensations");

// A10 compensations: the accountant's queue (compensation.approve decides; complaints.manage reads and withdraws).
export default function CompensationsPage() {
  return <CompensationsScreen />;
}
