import { navMetadata } from "../../_components/metadata";
import { WorkersScreen } from "./WorkersScreen";

export const generateMetadata = () => navMetadata("workers");

// A05 workers (spec §6.7, §14.3, §17; permissions workers.view, workers.manage, leave.manage).
export default function WorkersPage() {
  return <WorkersScreen />;
}
