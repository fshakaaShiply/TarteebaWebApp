import { navMetadata } from "../../../_components/metadata";
import { CustomerDetailScreen } from "./CustomerDetailScreen";

export const generateMetadata = () => navMetadata("customersList");

// A07 one customer: profile, notes, blocks, consents and privacy requests (addressed by the customer's ULID, P5-X11).
export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  return <CustomerDetailScreen id={id} />;
}
