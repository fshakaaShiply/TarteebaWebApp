import { navMetadata } from "../../../_components/metadata";
import { PackagesScreen } from "./PackagesScreen";

export const generateMetadata = () => navMetadata("packages");

// A11 recurring packages (spec §17; permission catalog.manage).
export default function CatalogPackagesPage() {
  return <PackagesScreen />;
}
