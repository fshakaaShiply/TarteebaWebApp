import { navMetadata } from "../../../_components/metadata";
import { ServicesScreen } from "./ServicesScreen";

export const generateMetadata = () => navMetadata("services");

// A11 services & prices (spec §17; permission catalog.manage; design AdminSettings.dc.html).
export default function CatalogServicesPage() {
  return <ServicesScreen />;
}
