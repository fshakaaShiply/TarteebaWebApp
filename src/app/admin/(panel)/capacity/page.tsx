import { navMetadata } from "../../_components/metadata";
import { CapacityScreen } from "./CapacityScreen";

export const generateMetadata = () => navMetadata("capacity");

// Capacity view and manual override (spec §8, §14.3 "Capacity", §17 A04; permissions schedule.view, capacity.override).
// The overview's "uncovered visits" card links here with ?date=&zone_id=.
export default async function CapacityPage({ searchParams }: PageProps<"/admin/capacity">) {
  const { date, zone_id: zone } = await searchParams;
  const zoneId = typeof zone === "string" && /^\d{1,9}$/.test(zone) ? Number(zone) : null;
  return <CapacityScreen initialDate={typeof date === "string" ? date : undefined} initialZoneId={zoneId} />;
}
