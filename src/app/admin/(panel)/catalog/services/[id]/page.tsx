import { navMetadata } from "../../../../_components/metadata";
import { ServiceDetailScreen } from "./ServiceDetailScreen";

export const generateMetadata = () => navMetadata("services");

// A11 one service: general fields, price matrix, packages / Live-out plans and "preview before publish" (spec §17).
export default async function CatalogServicePage({ params }: PageProps<"/admin/catalog/services/[id]">) {
  const { id } = await params;
  return <ServiceDetailScreen id={id} />;
}
