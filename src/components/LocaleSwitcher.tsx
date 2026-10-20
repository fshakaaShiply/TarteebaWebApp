"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locale === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      disabled={pending}
      lang={next}
      onClick={() =>
        startTransition(async () => {
          await setLocale(next);
          router.refresh();
        })
      }
      className={`rounded-pill px-3 py-1 text-sm font-medium underline-offset-4 hover:underline disabled:opacity-50 ${className}`}
    >
      {t("switchToOther")}
    </button>
  );
}
