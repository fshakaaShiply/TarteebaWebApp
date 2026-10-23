import { navMetadata } from "../../../_components/metadata";
import { DriverReportsScreen } from "./DriverReportsScreen";

export const generateMetadata = () => navMetadata("driverReports");

// A06 driver reports inbox (spec §6.8, §18 D03; trips.manage handles a report, schedule.view reads the inbox).
export default function DriverReportsPage() {
  return <DriverReportsScreen />;
}
