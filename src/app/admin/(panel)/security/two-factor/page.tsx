import { navMetadata } from "../../../_components/metadata";
import { TwoFactorScreen } from "./TwoFactorScreen";

export const generateMetadata = () => navMetadata("access");

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

// A01 account security: two-factor enrolment (required for some roles, P1-10) and turning it off.
export default async function TwoFactorPage({ searchParams }: PageProps<"/admin/security/two-factor">) {
  const params = await searchParams;
  return <TwoFactorScreen next={first(params.next)} />;
}
