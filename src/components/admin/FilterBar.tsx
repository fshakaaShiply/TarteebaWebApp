"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { controlClasses } from "./Field";

/** Filters above a table: search first, then selects, then "Clear filters" when anything is set. */
export function FilterBar({
  children,
  onReset,
  canReset,
  className,
}: {
  children: ReactNode;
  onReset?: () => void;
  canReset?: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.ui");
  return (
    <div role="search" className={clsx("flex flex-wrap items-end gap-3", className)}>
      {children}
      {onReset && canReset && (
        <Button variant="ghost" size="md" onClick={onReset}>
          {t("clearFilters")}
        </Button>
      )}
    </div>
  );
}

/** Search box with a visible label for screen readers only and a leading icon. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx("flex min-w-[220px] flex-1 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-600" />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={clsx(controlClasses, "h-11 ps-9")}
        />
      </div>
    </div>
  );
}
