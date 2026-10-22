import { navMetadata } from "../../../_components/metadata";
import { DriversScreen } from "./DriversScreen";

export const generateMetadata = () => navMetadata("drivers");

// A06 drivers (spec §6.8, §14.3, §17; permission fleet.manage).
export default function DriversPage() {
  return <DriversScreen />;
}
