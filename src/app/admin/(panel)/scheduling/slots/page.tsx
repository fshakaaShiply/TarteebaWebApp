import { navMetadata } from "../../../_components/metadata";
import { SlotTemplatesScreen } from "./SlotTemplatesScreen";

export const generateMetadata = () => navMetadata("slotTemplates");

// A11 slot templates (spec §6.4, §14.3, §17; permission catalog.manage).
export default function SlotTemplatesPage() {
  return <SlotTemplatesScreen />;
}
