import { navMetadata } from "../../../_components/metadata";
import { RatingsScreen } from "./RatingsScreen";

export const generateMetadata = () => navMetadata("qualityRatings");

// A10 ratings: every rating with the cleaner it counts for, exclusion with a reason (complaints.manage).
export default function RatingsPage() {
  return <RatingsScreen />;
}
