import { navMetadata } from "../../../_components/metadata";
import { AddonsScreen } from "./AddonsScreen";

export const generateMetadata = () => navMetadata("addons");

// A11 add-ons such as company materials (spec §6.3, §17; permission catalog.manage; P1-02).
export default function CatalogAddonsPage() {
  return <AddonsScreen />;
}
