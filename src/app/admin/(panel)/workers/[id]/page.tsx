import { navMetadata } from "../../../_components/metadata";
import { WorkerDetailScreen } from "./WorkerDetailScreen";

export const generateMetadata = () => navMetadata("workers");

// A05 one worker: info, weekly schedule and rest day, services and skills, leave (spec §17).
export default async function WorkerPage({ params, searchParams }: PageProps<"/admin/workers/[id]">) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <WorkerDetailScreen id={id} initialTab={typeof tab === "string" ? tab : undefined} />;
}
