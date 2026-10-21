import clsx from "clsx";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/** Page title row (design: h1 + one-line subtitle, actions at the end). */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-[26px]/[34px] font-bold text-ink-900">{title}</h1>
        {subtitle && <p className="text-sm text-ink-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** White card section (radius-lg, card shadow, admin card padding). */
export function Card({
  title,
  actions,
  children,
  className,
  as: Tag = "section",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={clsx("flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-5 shadow-card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg/7 font-bold text-ink-900">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export type NoticeTone = "info" | "warning" | "danger" | "success" | "neutral";

const noticeTones: Record<NoticeTone, { box: string; Icon: typeof Info }> = {
  info: { box: "bg-info-50 text-info-700", Icon: Info },
  warning: { box: "bg-apricot-100 text-warning-700", Icon: TriangleAlert },
  danger: { box: "bg-danger-50 text-danger-700", Icon: CircleAlert },
  success: { box: "bg-sage-100 text-success-700", Icon: CircleCheck },
  neutral: { box: "bg-neutral-100 text-ink-600", Icon: Info },
};

/** Inline message box (design: lockout note, permission note, preview note). Danger notices are alerts. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status" | "none";
}) {
  const { box, Icon } = noticeTones[tone];
  const ariaRole = role === "none" ? undefined : (role ?? (tone === "danger" ? "alert" : "status"));
  return (
    <div role={ariaRole} className={clsx("flex items-start gap-2.5 rounded-md px-3.5 py-3 text-[13px]/5 font-medium", box, className)}>
      <Icon aria-hidden className="mt-px size-4.5 shrink-0" strokeWidth={1.75} />
      <div className="flex flex-1 flex-col gap-1">
        {title && <p className="font-bold">{title}</p>}
        {children}
        {action}
      </div>
    </div>
  );
}
