import { navMetadata } from "../../../_components/metadata";
import { RefundsScreen } from "./RefundsScreen";

export const generateMetadata = () => navMetadata("refunds");

// A09 refunds with the provider's status (spec §10.4, §14.3; refunds.create or payments.view).
export default function RefundsPage() {
  return <RefundsScreen />;
}
