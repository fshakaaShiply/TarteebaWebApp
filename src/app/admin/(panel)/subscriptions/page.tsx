import { Suspense } from "react";
import { LoadingBlock } from "@/components/admin";
import { navMetadata } from "../../_components/metadata";
import { SubscriptionsScreen } from "./SubscriptionsScreen";

export const generateMetadata = () => navMetadata("subscriptions");

// A08 subscriptions list (spec §17; subscriptions.view or subscriptions.manage). Filters live in the URL (read on the client).
export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<LoadingBlock lines={6} className="rounded-lg bg-surface p-5 shadow-card" />}>
      <SubscriptionsScreen />
    </Suspense>
  );
}
