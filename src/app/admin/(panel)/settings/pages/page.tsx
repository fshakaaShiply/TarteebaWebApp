import { navMetadata } from "../../../_components/metadata";
import { LegalPagesScreen } from "./LegalPagesScreen";

export const generateMetadata = () => navMetadata("legalPages");

// A11 legal pages: terms, privacy and cancellation, versioned (settings.manage).
export default function LegalPagesPage() {
  return <LegalPagesScreen />;
}
