import { navMetadata } from "../../../_components/metadata";
import { VehiclesScreen } from "./VehiclesScreen";

export const generateMetadata = () => navMetadata("vehicles");

// A06 vehicles (spec §6.8, §14.3, §17; fleet.manage edits, schedule.view reads).
export default function VehiclesPage() {
  return <VehiclesScreen />;
}
