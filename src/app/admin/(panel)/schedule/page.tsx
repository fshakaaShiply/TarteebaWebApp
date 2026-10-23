import { Suspense } from "react";
import { LoadingBlock } from "@/components/admin";
import { navMetadata } from "../../_components/metadata";
import { ScheduleScreen } from "./ScheduleScreen";

export const generateMetadata = () => navMetadata("schedule");

// A04 operations schedule (spec §14.3, §17; schedule.view, moves assignments.manage). The view, date and filters live in
// the URL (read on the client).
export default function SchedulePage() {
  return (
    <Suspense fallback={<LoadingBlock lines={8} className="rounded-lg bg-surface p-5 shadow-card" />}>
      <ScheduleScreen />
    </Suspense>
  );
}
