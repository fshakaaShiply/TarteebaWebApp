import { navMetadata } from "../../../../_components/metadata";
import { IncentivePostingScreen } from "./IncentivePostingScreen";

export const generateMetadata = () => navMetadata("incentivePostings");

// A09 one incentive posting: its lines and the CSV for accounting (incentives.approve or incentives.view).
export default async function IncentivePostingPage({ params }: PageProps<"/admin/finance/incentive-postings/[id]">) {
  const { id } = await params;
  return <IncentivePostingScreen id={id} />;
}
