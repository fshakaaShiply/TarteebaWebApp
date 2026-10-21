"use client";

import { LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, PageHeader } from "@/components/admin";
import { useAdminSession } from "@/lib/admin/session";

export function OverviewPlaceholder() {
  const t = useTranslations("admin.overview");
  const { me } = useAdminSession();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("greeting", { name: me.name })} />
      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-pill bg-petrol-50 text-petrol-700">
            <LayoutDashboard aria-hidden className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-base font-bold text-ink-900">{t("comingTitle")}</p>
          <p className="max-w-md text-sm/6 text-ink-600">{t("comingBody")}</p>
        </div>
      </Card>
    </>
  );
}
