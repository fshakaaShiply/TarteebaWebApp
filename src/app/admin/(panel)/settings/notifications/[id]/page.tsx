import { navMetadata } from "../../../../_components/metadata";
import { TemplateEditorScreen } from "./TemplateEditorScreen";

export const generateMetadata = () => navMetadata("notificationTemplates");

// A11 one notification template: subject, body, placeholders, on/off and a preview in both languages (settings.manage).
export default async function NotificationTemplatePage({ params }: PageProps<"/admin/settings/notifications/[id]">) {
  const { id } = await params;
  return <TemplateEditorScreen id={id} />;
}
