import type { ReactNode } from "react";
import { AdminPanel } from "../_components/AdminPanel";

// Signed-in admin area: the session gate, navigation and top bar wrap every page (spec §17).
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return <AdminPanel>{children}</AdminPanel>;
}
