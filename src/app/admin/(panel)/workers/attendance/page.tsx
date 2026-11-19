import { navMetadata } from "../../../_components/metadata";
import { AttendanceSheetScreen } from "./AttendanceSheetScreen";

export const generateMetadata = () => navMetadata("attendance");

// A05 the day's attendance sheet (attendance.manage; workforce §5.4).
export default function AttendancePage() {
  return <AttendanceSheetScreen />;
}
