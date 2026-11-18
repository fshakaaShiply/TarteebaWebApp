"use client";

import clsx from "clsx";
import { Star } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A rating shown as stars, display only (A10 ratings and cases, the A03 quality block, A05 worker performance, A07
 * profile). The whole row is one image for a screen reader: "4 out of 5" / «4 من 5», never five separate stars. A
 * fractional value (an average such as 4.3) fills the last star by that fraction. `value` null is "no rating yet".
 */
export function StarRating({
  value,
  max = 5,
  size = "md",
  showValue = false,
  count,
  className,
}: {
  value: number | null | undefined;
  max?: number;
  size?: "sm" | "md" | "lg";
  /** Writes the number beside the stars ("4.3"). */
  showValue?: boolean;
  /** How many ratings an average is made of, written beside it. */
  count?: number;
  className?: string;
}) {
  const t = useTranslations("admin.ui.starRating");
  const known = typeof value === "number" && Number.isFinite(value);
  const clamped = known ? Math.min(max, Math.max(0, value)) : 0;
  const text = known ? numberText(clamped) : null;
  const px = size === "sm" ? "size-3.5" : size === "lg" ? "size-6" : "size-4.5";

  return (
    <span className={clsx("inline-flex items-center gap-1.5", className)}>
      <span
        role="img"
        aria-label={known ? t("label", { value: text ?? "", max }) : t("none")}
        // The stars run in the reading direction of the page: the first star is at the start.
        className="inline-flex items-center gap-0.5"
      >
        {Array.from({ length: max }, (_, i) => {
          const fill = Math.min(1, Math.max(0, clamped - i));
          return (
            <span key={i} aria-hidden className={clsx("relative inline-block", px)}>
              <Star className={clsx("absolute inset-0", px, "text-line-strong")} strokeWidth={1.75} />
              {fill > 0 && (
                <span className="absolute inset-y-0 start-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                  <Star className={clsx(px, "max-w-none fill-apricot-400 text-apricot-400")} strokeWidth={1.75} />
                </span>
              )}
            </span>
          );
        })}
      </span>
      {showValue && <span className="font-latin text-sm font-medium text-ink-900">{known ? text : "—"}</span>}
      {typeof count === "number" && <span className="text-xs text-ink-600">{t("count", { count })}</span>}
    </span>
  );
}

/** 4 → "4", 4.25 → "4.3" (one decimal, no trailing zero). */
function numberText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
