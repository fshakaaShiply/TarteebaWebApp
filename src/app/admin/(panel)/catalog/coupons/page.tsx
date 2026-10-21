import { navMetadata } from "../../../_components/metadata";
import { CouponsScreen } from "./CouponsScreen";

export const generateMetadata = () => navMetadata("coupons");

// A11 coupons (spec §6.3, §9.1, §17; permission catalog.manage; R-07 fixed coupons are net).
export default function CatalogCouponsPage() {
  return <CouponsScreen />;
}
