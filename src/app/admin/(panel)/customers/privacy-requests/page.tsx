import { navMetadata } from "../../../_components/metadata";
import { PrivacyRequestsScreen } from "./PrivacyRequestsScreen";

export const generateMetadata = () => navMetadata("privacyRequests");

// A07 privacy requests: data copies and account deletions (customers.privacy_requests).
export default function PrivacyRequestsPage() {
  return <PrivacyRequestsScreen />;
}
