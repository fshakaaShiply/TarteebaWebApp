"use client";

import { Construction } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, PageHeader } from "@/components/admin";
import { RequirePermission } from "./RequirePermission";

/**
 * Placeholder for an A11 page that the catalog phase fills in. Keeps the route, the permission gate and the page
 * title in place so the nav already works.
 */
export function ModuleStub({ titleKey, anyOf }: { titleKey: string; anyOf: readonly string[] }) {
  const nav = useTranslations("admin.nav");
  const t = useTranslations("admin.stub");
  return (
    <RequirePermission anyOf={anyOf}>
      <PageHeader title={nav(titleKey)} subtitle={t("subtitle")} />
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-pill bg-apricot-100 text-warning-700">
            <Construction aria-hidden className="size-6" strokeWidth={1.75} />
          </span>
          <p className="text-base font-bold text-ink-900">{t("title")}</p>
          <p className="max-w-md text-sm/6 text-ink-600">{t("body")}</p>
        </div>
      </Card>
    </RequirePermission>
  );
}
