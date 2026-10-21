"use client";

import clsx from "clsx";
import { Inbox, RefreshCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { AdminApiError } from "@/lib/admin/client";
import { useAdminErrorMessage } from "@/lib/admin/errors";
import { Button } from "./Button";

/* Loading, empty, error and permission-denied states shared by every admin screen (spec §17). */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-sm bg-neutral-100", className)} />;
}

/** A few skeleton lines inside a status region that announces "Loading". */
export function LoadingBlock({ lines = 4, className }: { lines?: number; className?: string }) {
  const t = useTranslations("admin.ui");
  return (
    <div role="status" aria-live="polite" className={clsx("flex flex-col gap-3", className)}>
      <span className="sr-only">{t("loading")}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={clsx("h-5", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

function StateBox({
  icon,
  title,
  body,
  action,
  tone = "neutral",
  className,
  role,
}: {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={clsx("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}
    >
      <span
        className={clsx(
          "flex size-12 items-center justify-center rounded-pill",
          tone === "danger" ? "bg-danger-50 text-danger-700" : "bg-petrol-50 text-petrol-700",
        )}
      >
        {icon}
      </span>
      <p className="text-base font-bold text-ink-900">{title}</p>
      {body && <p className="max-w-md text-sm/6 text-ink-600">{body}</p>}
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title?: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("admin.ui");
  return (
    <StateBox
      icon={<Inbox aria-hidden className="size-6" strokeWidth={1.75} />}
      title={title ?? t("emptyTitle")}
      body={body}
      action={action}
      className={className}
    />
  );
}

/** "You don't have access to this page" (A01). Shown instead of any data the user may not see. */
export function PermissionDenied({ className }: { className?: string }) {
  const t = useTranslations("admin.ui");
  return (
    <StateBox
      role="alert"
      tone="danger"
      icon={<ShieldAlert aria-hidden className="size-6" strokeWidth={1.75} />}
      title={t("deniedTitle")}
      body={t("deniedBody")}
      className={className}
    />
  );
}

/**
 * A failed load with a retry button. A 403 renders PermissionDenied instead, so a screen can pass any query error
 * here.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("admin.ui");
  const describe = useAdminErrorMessage();
  if (error instanceof AdminApiError && error.status === 403 && error.code === "FORBIDDEN") {
    return <PermissionDenied className={className} />;
  }
  return (
    <StateBox
      role="alert"
      tone="danger"
      icon={<TriangleAlert aria-hidden className="size-6" strokeWidth={1.75} />}
      title={title ?? t("errorTitle")}
      body={error ? describe(error) : undefined}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry} icon={<RefreshCw aria-hidden className="size-4" />}>
            {t("retry")}
          </Button>
        )
      }
      className={className}
    />
  );
}
