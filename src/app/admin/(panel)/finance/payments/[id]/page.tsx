import { navMetadata } from "../../../../_components/metadata";
import { PaymentDetailScreen } from "./PaymentDetailScreen";

export const generateMetadata = () => navMetadata("payments");

// A09 one payment: amounts, provider details, refunds and the event log (spec §10.4, §17; payments.view).
export default async function PaymentPage({ params }: PageProps<"/admin/finance/payments/[id]">) {
  const { id } = await params;
  return <PaymentDetailScreen id={id} />;
}
