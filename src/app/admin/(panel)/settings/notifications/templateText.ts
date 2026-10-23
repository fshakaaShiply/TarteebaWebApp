"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

/** Labels for A11 notification templates (admin.notificationTemplates.enums.*); unknown values show as they are. */
export function useTemplateText() {
  const t = useTranslations("admin.notificationTemplates.enums");
  return useMemo(() => {
    const label = (group: string, value: string) => (t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value);
    return {
      audience: (value: string) => label("audience", value),
      channel: (value: string) => label("channel", value),
      group: (value: string | null) => (value === null ? t("group.other") : label("group", value)),
      language: (value: string) => label("language", value),
    };
  }, [t]);
}
