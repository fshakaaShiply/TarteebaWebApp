import { Suspense } from "react";
import { LoadingBlock } from "@/components/admin";
import { navMetadata } from "../../_components/metadata";
import { BookingsScreen } from "./BookingsScreen";

export const generateMetadata = () => navMetadata("bookings");

// A03 bookings list (spec §14.3, §17; bookings.view). Filters live in the URL (read on the client).
export default function BookingsPage() {
  return (
    <Suspense fallback={<LoadingBlock lines={6} className="rounded-lg bg-surface p-5 shadow-card" />}>
      <BookingsScreen />
    </Suspense>
  );
}
