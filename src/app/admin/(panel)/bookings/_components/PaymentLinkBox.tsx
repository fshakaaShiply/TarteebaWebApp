"use client";

import { Copy, ExternalLink, MessageCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buttonClasses, Button, Notice, useToast } from "@/components/admin";
import { bilingualMessage, normalizeUaePhone, whatsappLink } from "@/lib/admin/bookings/manual";
import { formatDateTime, formatIsoDate } from "@/lib/admin/format";

/**
 * The payment link of a manual booking (spec §6.2): Copy, and "Open WhatsApp" with a message filled in, in the
 * customer's language first and then the other one. The web never sends anything itself: WhatsApp opens on the
 * coordinator's device and the coordinator presses send. (The API's own notifications, e.g. an SMS with the link,
 * are listed on the booking's "Notifications sent".)
 */
export function PaymentLinkBox({
  link,
  expiresAt,
  phone,
  customerName,
  customerLocale,
  reference,
  serviceDate,
}: {
  link: string | null;
  expiresAt: string | null;
  phone: string;
  customerName: string | null;
  customerLocale: "ar" | "en";
  reference: string;
  serviceDate: string;
}) {
  const t = useTranslations("admin.paymentLink");
  const locale = useLocale();
  const toast = useToast();

  if (!link) {
    return (
      <Notice tone="warning" title={t("missingTitle")}>
        {t("missingBody")}
      </Notice>
    );
  }

  // The name is optional (API and wizard): without one the greeting has no name rather than an empty gap.
  const name = customerName?.trim() ?? "";
  const greeting = { name, hasName: name ? "yes" : "no" };
  const message = bilingualMessage(customerLocale, {
    ar: t("whatsappAr", { ...greeting, reference, date: formatIsoDate(serviceDate, "ar"), link }),
    en: t("whatsappEn", { ...greeting, reference, date: formatIsoDate(serviceDate, "en"), link }),
  });
  const phoneE164 = normalizeUaePhone(phone) ?? phone;
  const whatsapp = whatsappLink(phoneE164, message);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <p className="text-sm font-bold text-ink-900">{t("title")}</p>
      <input
        readOnly
        value={link}
        aria-label={t("linkLabel")}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="h-11 w-full rounded-sm border border-line-strong bg-neutral-100 px-3 font-latin text-sm text-ink-900"
      />
      {expiresAt && <p className="text-xs text-ink-600">{t("expires", { time: formatDateTime(expiresAt, locale) })}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()} icon={<Copy aria-hidden className="size-4" />}>
          {t("copy")}
        </Button>
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={buttonClasses("outline", "md")}>
            <MessageCircle aria-hidden className="size-4" />
            {t("whatsapp")}
            <ExternalLink aria-hidden className="size-3.5 rtl:-scale-x-100" />
            <span className="sr-only">{t("newTab")}</span>
          </a>
        )}
      </div>
      <p className="text-xs text-ink-600">{t("notSent")}</p>
    </div>
  );
}
