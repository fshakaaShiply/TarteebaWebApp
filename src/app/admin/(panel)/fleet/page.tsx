import { redirect } from "next/navigation";

// A06 has no page of its own: vehicles is its first page (the trip planner is /admin/trips, the reports /admin/trips/reports).
export default function FleetPage() {
  redirect("/admin/fleet/vehicles");
}
