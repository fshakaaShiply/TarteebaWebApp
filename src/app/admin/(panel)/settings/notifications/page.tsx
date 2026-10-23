import { navMetadata } from "../../../_components/metadata";
import { NotificationTemplatesScreen } from "./NotificationTemplatesScreen";

export const generateMetadata = () => navMetadata("notificationTemplates");

// A11 notification templates, Arabic and English (spec §12, §17; permission settings.manage; design AdminSettings.dc.html).
export default function NotificationTemplatesPage() {
  return <NotificationTemplatesScreen />;
}
