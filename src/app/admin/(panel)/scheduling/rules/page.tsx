import { navMetadata } from "../../../_components/metadata";
import { SlotRulesScreen } from "./SlotRulesScreen";

export const generateMetadata = () => navMetadata("slotRules");

// A11 slot availability rules (spec §6.4, §14.3, §17; permission catalog.manage; decision P2-12 for which rule wins).
export default function SlotRulesPage() {
  return <SlotRulesScreen />;
}
