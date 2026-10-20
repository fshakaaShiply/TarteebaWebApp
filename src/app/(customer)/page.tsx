import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AppCta } from "./_components/AppCta";
import { Areas } from "./_components/Areas";
import { Faq } from "./_components/Faq";
import { Hero } from "./_components/Hero";
import { HowItWorks } from "./_components/HowItWorks";
import { Services } from "./_components/Services";
import { SiteFooter } from "./_components/SiteFooter";
import { SiteHeader } from "./_components/SiteHeader";
import { WhyUs } from "./_components/WhyUs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
  return { title: { absolute: t("title") }, description: t("description") };
}

// Public landing page. Booking happens in the app; customer web pages (policies, help, invoices) live alongside.
export default function LandingPage() {
  return (
    <div id="top" className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Services />
        <HowItWorks />
        <WhyUs />
        <Areas />
        <Faq />
        <AppCta />
      </main>
      <SiteFooter />
    </div>
  );
}
