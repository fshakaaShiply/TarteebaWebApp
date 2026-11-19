import { navMetadata } from "../../_components/metadata";
import { CustomersScreen } from "./CustomersScreen";

export const generateMetadata = () => navMetadata("customersList");

// A07 customers: search and the list (customers.view).
export default function CustomersPage() {
  return <CustomersScreen />;
}
