import { navMetadata } from "../../_components/metadata";
import { UsersScreen } from "./UsersScreen";

export const generateMetadata = () => navMetadata("staffUsers");

// A13 staff users and roles (spec §17; permission users.manage; design AdminUsers.dc.html).
export default function UsersPage() {
  return <UsersScreen />;
}
