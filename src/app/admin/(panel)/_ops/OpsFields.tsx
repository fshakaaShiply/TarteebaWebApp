"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { Select, StatusBadge } from "@/components/admin";
import { businessToday } from "@/lib/admin/format";
import { END_TIMES, START_TIMES } from "@/lib/admin/ops/fields";
import { expiryState } from "@/lib/admin/ops/fleet";
import { useOpsText } from "./opsText";

type TimeSelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  label: ReactNode;
  /** End times run 00:15 … 24:00; start times 00:00 … 23:45. */
  kind: "start" | "end";
  value: string;
  error?: ReactNode;
  hint?: ReactNode;
  containerClassName?: string;
};

/**
 * A time in 15-minute steps (the capacity engine's time blocks, spec §8.4). A stored value that is not on the grid
 * stays selectable, so opening an editor never changes it silently.
 */
export function TimeSelect({ label, kind, value, error, hint, className, containerClassName, ...props }: TimeSelectProps) {
  const grid = kind === "start" ? START_TIMES : END_TIMES;
  const options = (value && !grid.includes(value) ? [value, ...grid] : grid).map((v) => ({ value: v, label: v }));
  return (
    <Select
      label={label}
      options={options}
      value={value}
      error={error}
      hint={hint}
      dir="ltr"
      className={clsx("font-latin text-start", className)}
      containerClassName={containerClassName}
      {...props}
    />
  );
}

/** "Expired" / "Expires soon" next to a document date (insurance, registration, licence), within 30 days. */
export function ExpiryBadge({ date, today = businessToday() }: { date: string | null | undefined; today?: string }) {
  const t = useTranslations("admin.ops.expiry");
  const state = expiryState(date, today);
  if (state === "expired") return <StatusBadge tone="danger">{t("expired")}</StatusBadge>;
  if (state === "soon") return <StatusBadge tone="pending">{t("soon")}</StatusBadge>;
  return null;
}

/** A document date with its badge; "—" style "not recorded" text when empty. */
export function ExpiryDate({ date }: { date: string | null | undefined }) {
  const t = useTranslations("admin.ops.expiry");
  const text = useOpsText();
  if (!date) return <span className="text-sm text-ink-600">{t("none")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-ink-900">{text.dateShort(date)}</span>
      <ExpiryBadge date={date} />
    </span>
  );
}

/** Definition list row used by read-only profiles. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-0.5", className)}>
      <dt className="text-xs font-medium text-ink-600">{label}</dt>
      <dd className="text-sm text-ink-900">{children}</dd>
    </div>
  );
}
