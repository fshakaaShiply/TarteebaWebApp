import { navMetadata } from "../../../_components/metadata";
import { BookingDetailScreen } from "./BookingDetailScreen";

export const generateMetadata = () => navMetadata("bookings");

// A03 one booking: details, actions, assignment, notes and history (spec §14.3, §17; bookings.view).
export default async function BookingPage({ params }: PageProps<"/admin/bookings/[id]">) {
  const { id } = await params;
  return <BookingDetailScreen id={id} />;
}
