import { navMetadata } from "../../../_components/metadata";
import { ExportsScreen } from "./ExportsScreen";

export const generateMetadata = () => navMetadata("exports");

// A09 exports: the files this person asked for in the last days, each with a fresh download link (reports.export).
export default function ExportsPage() {
  return <ExportsScreen />;
}
