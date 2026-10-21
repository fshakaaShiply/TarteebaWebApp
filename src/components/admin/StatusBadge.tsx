import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Status colours shared by app and admin (spec §27.5). Every badge carries a text label, never colour alone.
 *   pending   → pending confirmation, locked, needs attention
 *   confirmed → confirmed, assigned, selected
 *   progress  → en route, arrived, in progress
 *   success   → completed, active, on
 *   danger    → cancelled, rejected, failed, suspended
 *   neutral   → verifying, draft, off
 */
export type StatusTone = "pending" | "confirmed" | "progress" | "success" | "danger" | "neutral";

const tones: Record<StatusTone, string> = {
  pending: "bg-apricot-100 text-warning-700",
  confirmed: "bg-petrol-50 text-petrol-700",
  progress: "bg-info-50 text-info-700",
  success: "bg-sage-100 text-success-700",
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-neutral-100 text-ink-600",
};

export function StatusBadge({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-[13px]/5 font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
