import { AdminHome } from "./AdminHome";

// /admin → the first page this user can open (catalog, settings, users, else the overview placeholder).
export default function AdminIndexPage() {
  return <AdminHome />;
}
