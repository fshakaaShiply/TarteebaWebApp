import { parseSeriesMove } from "@/lib/admin/subscriptions/handoff";
import { navMetadata } from "../../../_components/metadata";
import { SubscriptionDetailScreen } from "./SubscriptionDetailScreen";

export const generateMetadata = () => navMetadata("subscriptions");

// A08 one subscription: header, banners, actions and the tabs Overview, Visits, Calendar (Live-out), Periods and History
// (spec §17; subscriptions.view or subscriptions.manage). Addressed by the numeric id, like the API. A link from the A04
// board may name a visit to move and where it was dropped (lib/admin/subscriptions/handoff.ts).
export default async function SubscriptionPage({ params, searchParams }: PageProps<"/admin/subscriptions/[id]">) {
  const { id } = await params;
  const handoff = parseSeriesMove(await searchParams);
  return <SubscriptionDetailScreen id={id} handoff={handoff} />;
}
