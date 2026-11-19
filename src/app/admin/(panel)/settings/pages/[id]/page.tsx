import { navMetadata } from "../../../../_components/metadata";
import { LegalPageEditorScreen } from "./LegalPageEditorScreen";

export const generateMetadata = () => navMetadata("legalPages");

// A11 one legal page version: edit a draft, preview it as customers read it, publish it.
export default async function LegalPageEditorPage({ params }: PageProps<"/admin/settings/pages/[id]">) {
  const { id } = await params;
  return <LegalPageEditorScreen id={id} />;
}
