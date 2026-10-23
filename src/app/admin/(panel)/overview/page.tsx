import { navMetadata } from "../../_components/metadata";
import { OverviewScreen } from "./OverviewScreen";

export const generateMetadata = () => navMetadata("overview");

// A02 daily operations overview (spec §14.3, §17; bookings.view or schedule.view). /admin opens it for those roles.
export default function OverviewPage() {
  return <OverviewScreen />;
}
