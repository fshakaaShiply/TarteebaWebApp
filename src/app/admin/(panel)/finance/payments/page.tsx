import { navMetadata } from "../../../_components/metadata";
import { PaymentsScreen } from "./PaymentsScreen";

export const generateMetadata = () => navMetadata("payments");

// A09 transactions (spec §14.3, §17; permission payments.view; design AdminFinance.dc.html).
export default function PaymentsPage() {
  return <PaymentsScreen />;
}
