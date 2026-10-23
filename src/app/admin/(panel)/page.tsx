import { AdminHome } from "./AdminHome";

// /admin → the first page this user can open: the A02 overview for booking and schedule roles, else catalog, settings,
// users, workers or vehicles, else the overview's welcome note.
export default function AdminIndexPage() {
  return <AdminHome />;
}
