import { navMetadata } from "../../_components/metadata";
import { CapacityScreen } from "./CapacityScreen";

export const generateMetadata = () => navMetadata("capacity");

// Capacity view and manual override (spec §8, §14.3 "Capacity", §17 A04; permissions schedule.view, capacity.override).
export default function CapacityPage() {
  return <CapacityScreen />;
}
