import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getPublicConfig } from "@/lib/server/publicConfig";
import { PaymentResult, paymentReference } from "./PaymentResult";

export async function generateMetadata(): Promise<Metadata> {
  const ar = await getTranslations({ locale: "ar", namespace: "paymentResult" });
  const en = await getTranslations({ locale: "en", namespace: "paymentResult" });
  return { title: { absolute: `${ar("metaTitle")} · ${en("metaTitle")}` } };
}

// Public page after paying a manual-booking link (no sign-in). `status` in the URL is ignored on purpose: only the
// payment provider says whether a payment went through.
export default async function PaymentResultPage({ searchParams }: PageProps<"/payment/result">) {
  const { payment } = await searchParams;
  const [ar, en, config] = await Promise.all([
    getTranslations({ locale: "ar", namespace: "paymentResult" }),
    getTranslations({ locale: "en", namespace: "paymentResult" }),
    getPublicConfig(),
  ]);
  return <PaymentResult ar={ar} en={en} reference={paymentReference(payment)} support={config?.support ?? null} />;
}
