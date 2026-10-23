"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Round, RoundStop } from "@/lib/admin/types";

const STEP = 64;
const PAD = 28;
const Y = 26;

/**
 * DECISION (no maps key yet): instead of a map, a sketch of the stop order — the start, then each stop in driving order
 * with its ETA — drawn in the reading direction. It is not to scale; the ordered list above carries the details.
 */
export function StopSketch({ round, stops }: { round: Round; stops: readonly RoundStop[] }) {
  const t = useTranslations("admin.trips.sketch");
  const rtl = useLocale() === "ar";
  const points = stops.length + 1;
  const width = PAD * 2 + STEP * (points - 1);
  const x = (i: number) => (rtl ? width - PAD - i * STEP : PAD + i * STEP);
  const label = t("label", {
    depart: round.depart_local,
    stops: stops.map((s, i) => t("stop", { position: i + 1, reference: s.booking.reference, eta: s.eta_local ?? "—" })).join(t("separator")),
  });

  return (
    <figure className="flex flex-col gap-1">
      <div className="overflow-x-auto">
        <svg role="img" aria-label={label} viewBox={`0 0 ${width} 64`} width={width} height={64} className="max-w-none text-ink-600">
          <line x1={x(0)} y1={Y} x2={x(points - 1)} y2={Y} className="stroke-line-strong" strokeWidth={2} strokeDasharray="4 4" />
          <rect x={x(0) - 9} y={Y - 9} width={18} height={18} rx={4} className="fill-ink-900" />
          <text x={x(0)} y={Y + 26} textAnchor="middle" className="fill-ink-600 font-latin text-[10px]">
            {round.depart_local}
          </text>
          {stops.map((s, i) => {
            const cx = x(i + 1);
            const warn = round.warnings.some((w) => w.stop_id === s.id);
            return (
              <g key={s.id}>
                <circle cx={cx} cy={Y} r={11} className={warn ? "fill-warning-700" : s.done ? "fill-success-700" : "fill-petrol-700"} />
                <text x={cx} y={Y + 4} textAnchor="middle" className="fill-white font-latin text-[11px] font-bold">
                  {i + 1}
                </text>
                <text x={cx} y={Y + 26} textAnchor="middle" className="fill-ink-600 font-latin text-[10px]">
                  {s.eta_local ?? "—"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="text-xs text-ink-600">{t("caption")}</figcaption>
    </figure>
  );
}
