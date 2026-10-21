import { navMetadata } from "../../_components/metadata";
import { OverviewPlaceholder } from "./OverviewPlaceholder";

export const generateMetadata = () => navMetadata("overview");

// A02 daily operations overview arrives in Phase 3; until then this page welcomes users without catalog/users access.
export default function OverviewPage() {
  return <OverviewPlaceholder />;
}
