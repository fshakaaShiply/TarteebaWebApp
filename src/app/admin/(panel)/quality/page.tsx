import { navMetadata } from "../../_components/metadata";
import { QualityInboxScreen } from "./QualityInboxScreen";

export const generateMetadata = () => navMetadata("qualityInbox");

// A10 inbox: complaints, support requests and low-rating follow-ups with their SLA (spec §17; complaints.manage or compensation.approve).
export default function QualityPage() {
  return <QualityInboxScreen />;
}
