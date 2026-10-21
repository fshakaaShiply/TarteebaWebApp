import { navMetadata } from "../../_components/metadata";
import { ZonesScreen } from "./ZonesScreen";

export const generateMetadata = () => navMetadata("zones");

// A11 service zones and sub-zones with the polygon editor (spec §6.2, §17; permission catalog.manage, decision P1-05).
export default function ZonesPage() {
  return <ZonesScreen />;
}
