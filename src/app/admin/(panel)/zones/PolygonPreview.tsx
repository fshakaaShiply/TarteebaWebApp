"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { fitProjection, polygonPath } from "@/lib/admin/geo";
import type { GeoPolygon } from "@/lib/admin/types";

export type PreviewShape = {
  key: string;
  polygon: GeoPolygon;
  /** zone = the zone boundary, draft = the shape being edited, subZone = other sub-zones, inactive = switched off. */
  variant: "zone" | "draft" | "subZone" | "inactive";
};

const VARIANT_CLASSES: Record<PreviewShape["variant"], string> = {
  zone: "fill-petrol-50 stroke-petrol-700",
  draft: "fill-apricot-100/70 stroke-warning-700",
  subZone: "fill-sage-100/70 stroke-success-700",
  inactive: "fill-neutral-100/60 stroke-line-strong",
};

const WIDTH = 480;
const HEIGHT = 260;

/**
 * SVG preview of zone / sub-zone polygons (north up, proportions kept). A stand-in for the map editor until a Maps
 * key exists (see lib/admin/geo.ts). `highlight` marks one [lng, lat] point, e.g. a vertex outside the zone.
 */
export function PolygonPreview({
  shapes,
  highlight,
  label,
}: {
  shapes: PreviewShape[];
  highlight?: [number, number] | null;
  label: string;
}) {
  const height = HEIGHT;
  const t = useTranslations("admin.zones.preview");
  const projection = fitProjection(
    [...shapes.map((s) => s.polygon), ...(highlight ? [pointShape(highlight)] : [])],
    { width: WIDTH, height, padding: 16 },
  );
  const variants = new Set(shapes.map((s) => s.variant));

  return (
    <figure className="flex flex-col gap-2">
      {projection ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-label={label}
          className="h-auto w-full rounded-md border border-line bg-ivory-50"
        >
          {shapes.map((shape) => (
            <path
              key={shape.key}
              d={polygonPath(shape.polygon, projection)}
              fillRule="evenodd"
              strokeWidth={shape.variant === "zone" || shape.variant === "draft" ? 2 : 1.5}
              strokeDasharray={shape.variant === "subZone" || shape.variant === "inactive" ? "5 3" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className={VARIANT_CLASSES[shape.variant]}
            />
          ))}
          {highlight && (
            <circle
              cx={projection.project(highlight[0], highlight[1])[0]}
              cy={projection.project(highlight[0], highlight[1])[1]}
              r={6}
              className="fill-danger-700 stroke-surface"
              strokeWidth={2}
            />
          )}
        </svg>
      ) : (
        <div className="flex aspect-[24/13] items-center justify-center rounded-md border border-dashed border-line-strong bg-ivory-50 text-sm text-ink-600">
          {t("empty")}
        </div>
      )}
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
        {(["zone", "draft", "subZone", "inactive"] as const)
          .filter((v) => variants.has(v))
          .map((v) => (
            <span key={v} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={clsx("inline-block size-3 rounded-[3px] border", legendClass(v))} />
              {t(`legend.${v}`)}
            </span>
          ))}
        {highlight && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-3 rounded-pill bg-danger-700" />
            {t("legend.outside")}
          </span>
        )}
        <span>{t("northUp")}</span>
      </figcaption>
    </figure>
  );
}

function legendClass(variant: PreviewShape["variant"]): string {
  switch (variant) {
    case "zone":
      return "border-petrol-700 bg-petrol-50";
    case "draft":
      return "border-warning-700 bg-apricot-100";
    case "subZone":
      return "border-success-700 bg-sage-100";
    default:
      return "border-line-strong bg-neutral-100";
  }
}

/** A tiny square around a point so the projection keeps it in view. */
function pointShape([lng, lat]: [number, number]): GeoPolygon {
  const d = 1e-6;
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d],
      ],
    ],
  };
}
