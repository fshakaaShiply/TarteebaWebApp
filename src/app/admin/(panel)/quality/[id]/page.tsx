import { navMetadata } from "../../../_components/metadata";
import { ComplaintCaseScreen } from "../ComplaintCaseScreen";

export const generateMetadata = () => navMetadata("qualityInbox");

// A10 one case: conversation, reply, resolve and compensation (spec §17; the case is addressed by the API's numeric id).
export default async function QualityCasePage({ params }: PageProps<"/admin/quality/[id]">) {
  const { id } = await params;
  return <ComplaintCaseScreen id={id} />;
}
