import { navMetadata } from "../../_components/metadata";
import { SettingsScreen } from "./SettingsScreen";

export const generateMetadata = () => navMetadata("settings");

// A11 global settings (spec §17, §21; permission settings.manage; design AdminSettings.dc.html "إعدادات عامة").
export default function SettingsPage() {
  return <SettingsScreen />;
}
