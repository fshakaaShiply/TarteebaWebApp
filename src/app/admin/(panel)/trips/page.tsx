import { Suspense } from "react";
import { LoadingBlock } from "@/components/admin";
import { navMetadata } from "../../_components/metadata";
import { TripPlannerScreen } from "./TripPlannerScreen";

export const generateMetadata = () => navMetadata("trips");

// A06 trip planner (spec §6.8, §8.3, §14.3, §17; trips.manage plans, schedule.view reads). The date and slot live in the
// URL (read on the client).
export default function TripsPage() {
  return (
    <Suspense fallback={<LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />}>
      <TripPlannerScreen />
    </Suspense>
  );
}
