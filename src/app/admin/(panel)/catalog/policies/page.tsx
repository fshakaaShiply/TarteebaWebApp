import { navMetadata } from "../../../_components/metadata";
import { PoliciesScreen } from "./PoliciesScreen";

export const generateMetadata = () => navMetadata("policies");

// A11 cancellation / reschedule / refund policies (spec §11.4, §17; permission catalog.manage; D-02 placeholders).
export default function CatalogPoliciesPage() {
  return <PoliciesScreen />;
}
