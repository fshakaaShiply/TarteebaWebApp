import { navMetadata } from "../../../_components/metadata";
import { ManualBookingWizard } from "./ManualBookingWizard";

export const generateMetadata = () => navMetadata("bookings");

// A03 manual booking wizard (spec §6.2, §14.3, §17; bookings.create_manual).
export default function NewBookingPage() {
  return <ManualBookingWizard />;
}
