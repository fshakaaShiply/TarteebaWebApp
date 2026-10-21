import { navMetadata } from "../../../_components/metadata";
import { LiveOutPlansScreen } from "./LiveOutPlansScreen";

export const generateMetadata = () => navMetadata("liveOut");

// A11 Live-out plans (spec §11.3, §17; permission catalog.manage).
export default function CatalogLiveOutPage() {
  return <LiveOutPlansScreen />;
}
