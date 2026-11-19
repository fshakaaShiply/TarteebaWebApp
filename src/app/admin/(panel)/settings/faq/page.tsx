import { navMetadata } from "../../../_components/metadata";
import { FaqScreen } from "./FaqScreen";

export const generateMetadata = () => navMetadata("faq");

// A11 FAQ: the questions customers read in Help, in order (settings.manage).
export default function FaqPage() {
  return <FaqScreen />;
}
