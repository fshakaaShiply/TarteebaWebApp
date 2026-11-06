import { navMetadata } from "../../../_components/metadata";
import { SubscriptionDetailScreen } from "./SubscriptionDetailScreen";

export const generateMetadata = () => navMetadata("subscriptions");

// A08 one subscription: header, banners, actions and the tabs Overview, Visits, Calendar (Live-out), Periods and History
// (spec §17; subscriptions.view or subscriptions.manage). Addressed by the numeric id, like the API.
export default async function SubscriptionPage({ params }: PageProps<"/admin/subscriptions/[id]">) {
  const { id } = await params;
  return <SubscriptionDetailScreen id={id} />;
}
