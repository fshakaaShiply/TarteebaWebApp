import { z } from "zod";
import type { ZonePayload, SubZonePayload } from "./endpoints";
import { intInput, optionalIntInput, translatableInput, zoneCodeInput, emptyTranslatable, numText } from "./catalog/fields";
import type { GeoPolygon, SubZone, Zone } from "./types";

/*
 * Zone boundaries for A11 (spec §6.2). Until a map key exists the admin edits polygons as GeoJSON text, checked here
 * with the same rules as the API's PolygonValidator (so mistakes show before saving) and drawn as an SVG preview.
 *
 * DECISION: GeoJSON text + SVG preview for now; a Google Maps polygon editor replaces the text field once the
 * project has a Maps key (spec §17 "polygon map editor").
 */

/** PolygonValidator's reasons (InvalidPolygon::REASONS) plus "json" for text that is not JSON at all. */
export const POLYGON_REASONS = [
  "json",
  "not_an_object",
  "unsupported_type",
  "missing_coordinates",
  "invalid_position",
  "lng_out_of_range",
  "lat_out_of_range",
  "too_few_positions",
  "too_many_positions",
  "ring_not_closed",
  "degenerate_ring",
] as const;

export type PolygonReason = (typeof POLYGON_REASONS)[number];

export type PolygonCheck = { ok: true; polygon: GeoPolygon } | { ok: false; reason: PolygonReason; path: string | null };

/** PolygonValidator::MAX_POSITIONS */
export const MAX_POSITIONS = 10000;
/** Rings at or below this area (square degrees) are degenerate (PolygonValidator::MIN_AREA). */
const MIN_AREA = 1e-12;

type Position = [number, number];

class Invalid extends Error {
  constructor(
    readonly reason: PolygonReason,
    readonly path: string | null = null,
  ) {
    super(reason);
  }
}

const isList = (value: unknown): value is unknown[] => Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
}

function checkRing(ring: unknown, path: string, total: { count: number }): Position[] {
  if (!isList(ring) || ring.length < 4) throw new Invalid("too_few_positions", path);
  total.count += ring.length;
  if (total.count > MAX_POSITIONS) throw new Invalid("too_many_positions", path);
  const positions = ring.map((position, i): Position => {
    if (!isList(position) || position.length < 2 || !isNumber(position[0]) || !isNumber(position[1])) {
      throw new Invalid("invalid_position", `${path}.${i}`);
    }
    const [lng, lat] = position;
    if (lng < -180 || lng > 180) throw new Invalid("lng_out_of_range", `${path}.${i}`);
    if (lat < -90 || lat > 90) throw new Invalid("lat_out_of_range", `${path}.${i}`);
    return [lng, lat];
  });
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Invalid("ring_not_closed", path);
  if (Math.abs(signedArea(positions)) <= MIN_AREA) throw new Invalid("degenerate_ring", path);
  return positions;
}

/** Same rules as the API: Polygon or MultiPolygon, [lng, lat] (extra values dropped), closed rings of ≥ 4 points. */
export function validatePolygon(geometry: unknown): PolygonCheck {
  try {
    if (!geometry || typeof geometry !== "object" || isList(geometry) || Object.keys(geometry).length === 0) {
      throw new Invalid("not_an_object");
    }
    const g = geometry as { type?: unknown; coordinates?: unknown };
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") throw new Invalid("unsupported_type", "type");
    if (!isList(g.coordinates) || g.coordinates.length === 0) throw new Invalid("missing_coordinates", "coordinates");
    const total = { count: 0 };
    const polygon = (rings: unknown, path: string): Position[][] => {
      if (!isList(rings) || rings.length === 0) throw new Invalid("missing_coordinates", path);
      return rings.map((ring, r) => checkRing(ring, `${path}.${r}`, total));
    };
    if (g.type === "Polygon") return { ok: true, polygon: { type: "Polygon", coordinates: polygon(g.coordinates, "coordinates") } };
    return {
      ok: true,
      polygon: { type: "MultiPolygon", coordinates: g.coordinates.map((p, i) => polygon(p, `coordinates.${i}`)) },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.reason, path: error.path };
    throw error;
  }
}

/** Text from the GeoJSON field → geometry. A pasted GeoJSON Feature is accepted for its geometry. */
export function parsePolygonText(text: string): PolygonCheck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "json", path: null };
  }
  if (value && typeof value === "object" && (value as { type?: unknown }).type === "Feature") {
    value = (value as { geometry?: unknown }).geometry;
  }
  return validatePolygon(value);
}

/** Pretty GeoJSON with one position per line ([lng, lat]), easier to read and edit than JSON.stringify's layout. */
export function formatPolygonText(polygon: GeoPolygon): string {
  const ring = (r: number[][], indent: string) =>
    `[\n${r.map((p) => `${indent}  [${p[0]}, ${p[1]}]`).join(",\n")}\n${indent}]`;
  const rings = (rs: number[][][], indent: string) =>
    `[\n${rs.map((r) => `${indent}  ${ring(r, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  const coordinates =
    polygon.type === "Polygon"
      ? rings(polygon.coordinates, "  ")
      : `[\n${polygon.coordinates.map((p) => `    ${rings(p, "    ")}`).join(",\n")}\n  ]`;
  return `{\n  "type": "${polygon.type}",\n  "coordinates": ${coordinates}\n}`;
}

/** Every polygon of a geometry as a list of rings (outer ring first, then holes). */
export function polygonsOf(polygon: GeoPolygon): number[][][][] {
  return polygon.type === "Polygon" ? [polygon.coordinates] : polygon.coordinates;
}

export type Bounds = { minLng: number; maxLng: number; minLat: number; maxLat: number };

export function boundsOf(polygons: readonly GeoPolygon[]): Bounds | null {
  let b: Bounds | null = null;
  for (const geometry of polygons) {
    for (const rings of polygonsOf(geometry)) {
      for (const [lng, lat] of rings[0] ?? []) {
        b = b
          ? {
              minLng: Math.min(b.minLng, lng),
              maxLng: Math.max(b.maxLng, lng),
              minLat: Math.min(b.minLat, lat),
              maxLat: Math.max(b.maxLat, lat),
            }
          : { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat };
      }
    }
  }
  return b;
}

export type Projection = {
  width: number;
  height: number;
  /** [lng, lat] → SVG [x, y]; north is up. */
  project: (lng: number, lat: number) => [number, number];
};

/**
 * Fits the shapes into a width × height box (minus padding) with an equirectangular projection: longitude is scaled
 * by cos(mid-latitude) so city-scale shapes keep their proportions; y grows southwards as in SVG.
 */
export function fitProjection(
  polygons: readonly GeoPolygon[],
  { width, height, padding = 12 }: { width: number; height: number; padding?: number },
): Projection | null {
  const b = boundsOf(polygons);
  if (!b) return null;
  const k = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((b.maxLng - b.minLng) * k, 1e-9);
  const spanY = Math.max(b.maxLat - b.minLat, 1e-9);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  // Centre the drawing in the box.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    width,
    height,
    project: (lng, lat) => [offsetX + (lng - b.minLng) * k * scale, offsetY + (b.maxLat - lat) * scale],
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** SVG path data for a geometry (holes included; draw with fill-rule="evenodd"). */
export function polygonPath(polygon: GeoPolygon, projection: Projection): string {
  return polygonsOf(polygon)
    .flatMap((rings) =>
      rings.map((ring) => {
        const points = ring.slice(0, -1).map(([lng, lat]) => projection.project(lng, lat));
        return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L")} Z`;
      }),
    )
    .join(" ");
}

/** Ray casting with the boundary counted as inside (mirror of the API's PointInPolygon, EPSILON 1e-9). */
export function containsPoint(polygon: GeoPolygon, lng: number, lat: number): boolean {
  const EPS = 1e-9;
  const locate = (ring: number[][]): "in" | "out" | "edge" => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const len = Math.hypot(xj - xi, yj - yi);
      const within =
        lng >= Math.min(xi, xj) - EPS && lng <= Math.max(xi, xj) + EPS && lat >= Math.min(yi, yj) - EPS && lat <= Math.max(yi, yj) + EPS;
      if (within && (len < EPS || Math.abs((xj - xi) * (lat - yi) - (yj - yi) * (lng - xi)) / len <= EPS)) return "edge";
      if (yi > lat !== yj > lat && lng < xi + ((lat - yi) * (xj - xi)) / (yj - yi)) inside = !inside;
    }
    return inside ? "in" : "out";
  };
  return polygonsOf(polygon).some(([outer, ...holes]) => {
    if (!outer) return false;
    const where = locate(outer);
    if (where !== "in") return where === "edge";
    for (const hole of holes) {
      const h = locate(hole);
      if (h === "edge") return true;
      if (h === "in") return false;
    }
    return true;
  });
}

/** The first vertex of `sub` outside `zone` (SubZoneContainment), or null when the sub-zone fits. */
export function firstVertexOutside(zone: GeoPolygon, sub: GeoPolygon): [number, number] | null {
  for (const rings of polygonsOf(sub)) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) if (!containsPoint(zone, lng, lat)) return [lng, lat];
    }
  }
  return null;
}

// ---- Zone and sub-zone forms -----------------------------------------------------------------------------------

/** The polygon field: GeoJSON text → geometry; the issue message is "polygon.<reason>". */
export const polygonInput = z.string().transform((text, ctx): GeoPolygon => {
  if (text.trim() === "") {
    ctx.addIssue({ code: "custom", message: "required" });
    return z.NEVER;
  }
  const check = parsePolygonText(text);
  if (!check.ok) {
    ctx.addIssue({ code: "custom", message: `polygon.${check.reason}` });
    return z.NEVER;
  }
  return check.polygon;
});

export function zoneFormSchema(mode: "create" | "edit") {
  return z
    .object({
      code: zoneCodeInput(),
      name: translatableInput(120),
      polygon: polygonInput,
      default_travel_buffer_min: optionalIntInput("travelBuffer", 0, 240),
      sort_order: intInput("sortOrder", 0, 65535),
      is_active: z.boolean(),
      reason: z.string(),
    })
    .transform((v) => {
      const payload: ZonePayload = {
        code: v.code,
        name: v.name,
        polygon: v.polygon,
        default_travel_buffer_min: v.default_travel_buffer_min,
        sort_order: v.sort_order,
        // Deactivation has its own endpoint (with confirmation); edits only re-activate explicitly.
        ...(mode === "create" ? { is_active: v.is_active } : {}),
      };
      return { payload, reason: v.reason };
    });
}

export type ZoneFormValues = z.input<ReturnType<typeof zoneFormSchema>>;

export function zoneToFormValues(zone: Zone | null): ZoneFormValues {
  return {
    code: zone?.code ?? "",
    name: zone ? { ...zone.name } : emptyTranslatable(),
    polygon: zone ? formatPolygonText(zone.polygon) : "",
    default_travel_buffer_min: numText(zone?.default_travel_buffer_min),
    sort_order: zone ? String(zone.sort_order) : "0",
    is_active: zone?.is_active ?? true,
    reason: "",
  };
}

export const subZoneFormSchema = z
  .object({
    code: zoneCodeInput(),
    name: translatableInput(120),
    polygon: polygonInput,
    is_active: z.boolean(),
    reason: z.string(),
  })
  .transform(({ reason, ...payload }) => ({ payload: payload satisfies SubZonePayload, reason }));

export type SubZoneFormValues = z.input<typeof subZoneFormSchema>;

export function subZoneToFormValues(sub: SubZone | null): SubZoneFormValues {
  return {
    code: sub?.code ?? "",
    name: sub ? { ...sub.name } : emptyTranslatable(),
    polygon: sub ? formatPolygonText(sub.polygon) : "",
    is_active: sub?.is_active ?? true,
    reason: "",
  };
}
