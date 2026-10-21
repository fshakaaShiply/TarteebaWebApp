"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { TextField } from "./Field";

type MoneyFieldProps = Omit<ComponentPropsWithRef<"input">, "type" | "size"> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  containerClassName?: string;
};

/**
 * AED amount input. The admin types dirhams ("120.50"); convert with parseAedToFils (src/lib/money.ts) before
 * sending fils to the API, and fill it with filsToAedInput. Never float math.
 */
export function MoneyField(props: MoneyFieldProps) {
  const t = useTranslations("admin.ui");
  const locale = useLocale();
  return (
    <TextField
      inputMode="decimal"
      dir="ltr"
      autoComplete="off"
      placeholder="0.00"
      suffix={locale === "ar" ? t("currencyAr") : t("currencyEn")}
      className="font-latin text-start"
      {...props}
    />
  );
}
