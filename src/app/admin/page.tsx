import { redirect } from "next/navigation";

// A02 overview arrives in Phase 3; until staff auth exists (Phase 1) the panel starts at login.
export default function AdminIndex() {
  redirect("/admin/login");
}
