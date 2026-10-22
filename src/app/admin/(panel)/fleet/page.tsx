import { redirect } from "next/navigation";

// A06 has no page of its own yet (the trip planner comes in a later phase): vehicles is its first page.
export default function FleetPage() {
  redirect("/admin/fleet/vehicles");
}
