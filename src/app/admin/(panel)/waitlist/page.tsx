import { navMetadata } from "../../_components/metadata";
import { WaitlistScreen } from "./WaitlistScreen";

export const generateMetadata = () => navMetadata("waitlist");

// A04 waitlist: customers waiting for a place in a full slot, and the staff offer (waitlist.manage; waitlist §7.1).
export default function WaitlistPage() {
  return <WaitlistScreen />;
}
