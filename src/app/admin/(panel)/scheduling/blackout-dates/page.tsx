import { navMetadata } from "../../../_components/metadata";
import { BlackoutDatesScreen } from "./BlackoutDatesScreen";

export const generateMetadata = () => navMetadata("blackoutDates");

// A11 blackout dates (spec §6.4, §14.3, §17; permission catalog.manage).
export default function BlackoutDatesPage() {
  return <BlackoutDatesScreen />;
}
