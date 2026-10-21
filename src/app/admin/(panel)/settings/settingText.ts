"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { SETTING_OPTIONS } from "@/lib/admin/settings";
import type { Setting } from "@/lib/admin/types";

/**
 * Bilingual label and description for a setting (admin.settings.keys.<key>.label|description in the message files).
 * A key added on the API before the web app knows it falls back to the API description, then the key itself.
 */
export function useSettingText() {
  const t = useTranslations("admin.settings");

  const label = useCallback(
    (s: Pick<Setting, "key" | "description">) => {
      const key = `keys.${s.key}.label`;
      return t.has(key) ? t(key) : (s.description ?? s.key);
    },
    [t],
  );

  const description = useCallback(
    (s: Pick<Setting, "key" | "description">) => {
      const key = `keys.${s.key}.description`;
      if (t.has(key)) return t(key);
      // Without our own label the API description is already the label; don't repeat it.
      return t.has(`keys.${s.key}.label`) ? (s.description ?? null) : null;
    },
    [t],
  );

  const group = useCallback((name: string) => (t.has(`groups.${name}`) ? t(`groups.${name}`) : name), [t]);

  const option = useCallback(
    (settingKey: string, value: string) => {
      const options = SETTING_OPTIONS[settingKey];
      const key = options ? `options.${options.messageKey}.${value}` : null;
      return key && t.has(key) ? t(key) : value;
    },
    [t],
  );

  return useMemo(() => ({ label, description, group, option }), [label, description, group, option]);
}
