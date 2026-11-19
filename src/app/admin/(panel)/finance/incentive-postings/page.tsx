import { navMetadata } from "../../../_components/metadata";
import { IncentivePostingsScreen } from "./IncentivePostingsScreen";

export const generateMetadata = () => navMetadata("incentivePostings");

// A09 incentive postings: the payroll files HR posted, for accounting to download (incentives.approve or incentives.view).
export default function IncentivePostingsPage() {
  return <IncentivePostingsScreen />;
}
