import { describe, expect, it } from "vitest";
import {
  boundsOf,
  containsPoint,
  firstVertexOutside,
  fitProjection,
  formatPolygonText,
  parsePolygonText,
  polygonPath,
  subZoneFormSchema,
  validatePolygon,
  zoneFormSchema,
  zoneToFormValues,
} from "./geo";
import type { GeoPolygon } from "./types";

const ring = (points: [number, number][]) => [...points, points[0]];

// DemoZonesSeeder: DEMO_BB and its Downtown sub-zone.
const DEMO_BB: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    ring([
      [55.255, 25.1855],
      [55.2615, 25.1925],
      [55.2685, 25.2],
      [55.279, 25.2],
      [55.285, 25.196],
      [55.285, 25.188],
      [55.276, 25.185],
      [55.262, 25.185],
    ]),
  ],
};
const DOWNTOWN: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    ring([
      [55.27, 25.193],
      [55.28, 25.193],
      [55.283, 25.1965],
      [55.278, 25.199],
      [55.27, 25.199],
      [55.269, 25.196],
    ]),
  ],
};
const SQUARE: GeoPolygon = {
  type: "Polygon",
  coordinates: [
    ring([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]),
  ],
};

describe("polygon parser (mirrors PolygonValidator)", () => {
  it("accepts the demo zone and a pasted GeoJSON Feature", () => {
    expect(parsePolygonText(JSON.stringify(DEMO_BB))).toEqual({ ok: true, polygon: DEMO_BB });
    const feature = { type: "Feature", properties: {}, geometry: DEMO_BB };
    expect(parsePolygonText(JSON.stringify(feature))).toEqual({ ok: true, polygon: DEMO_BB });
  });

  it("drops a third value (altitude) from positions", () => {
    const withAltitude = { type: "Polygon", coordinates: [[[0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 0, 5]]] };
    expect(parsePolygonText(JSON.stringify(withAltitude))).toEqual({
      ok: true,
      polygon: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    });
  });

  it.each([
    ["{ nope", "json", null],
    ["[]", "not_an_object", null],
    ['{"type":"Point","coordinates":[1,2]}', "unsupported_type", "type"],
    ['{"type":"Polygon","coordinates":[]}', "missing_coordinates", "coordinates"],
    ['{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,0]]]}', "too_few_positions", "coordinates.0"],
    ['{"type":"Polygon","coordinates":[[[0,0],[1,"x"],[1,1],[0,0]]]}', "invalid_position", "coordinates.0.1"],
    ['{"type":"Polygon","coordinates":[[[0,0],[181,0],[1,1],[0,0]]]}', "lng_out_of_range", "coordinates.0.1"],
    ['{"type":"Polygon","coordinates":[[[0,0],[1,91],[1,1],[0,0]]]}', "lat_out_of_range", "coordinates.0.1"],
    ['{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}', "ring_not_closed", "coordinates.0"],
    ['{"type":"Polygon","coordinates":[[[0,0],[1,1],[2,2],[0,0]]]}', "degenerate_ring", "coordinates.0"],
    ['{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[]]}', "missing_coordinates", "coordinates.1"],
  ])("refuses %s (%s)", (text, reason, path) => {
    expect(parsePolygonText(text)).toEqual({ ok: false, reason, path });
  });

  it("caps the number of positions", () => {
    const big = Array.from({ length: 10001 }, (_, i) => [Math.cos(i) * 0.1, Math.sin(i) * 0.1]);
    big[big.length - 1] = big[0];
    expect(validatePolygon({ type: "Polygon", coordinates: [big] })).toMatchObject({ ok: false, reason: "too_many_positions" });
  });

  it("formats one position per line and parses back to the same geometry", () => {
    const multi: GeoPolygon = { type: "MultiPolygon", coordinates: [SQUARE.coordinates, DOWNTOWN.coordinates] };
    for (const geometry of [DEMO_BB, multi]) {
      const text = formatPolygonText(geometry);
      expect(parsePolygonText(text)).toEqual({ ok: true, polygon: geometry });
    }
    expect(formatPolygonText(SQUARE).split("\n")).toContain("      [2, 0],");
  });
});

describe("SVG projection", () => {
  it("fits the bounds into the box, north up, keeping proportions", () => {
    const projection = fitProjection([SQUARE], { width: 200, height: 200, padding: 0 });
    expect(projection).not.toBeNull();
    const p = projection!;
    // A 2 × 1 degree box at the equator (cos 0.5° ≈ 1) fills the width and is centred vertically.
    const [x0, y0] = p.project(0, 1);
    const [x1, y1] = p.project(2, 0);
    expect(x0).toBeCloseTo(0, 1);
    expect(x1).toBeCloseTo(200, 1);
    expect(y0).toBeCloseTo(50, 0);
    expect(y1).toBeCloseTo(150, 0);
    // North (higher latitude) is drawn above south.
    expect(p.project(1, 1)[1]).toBeLessThan(p.project(1, 0)[1]);
  });

  it("scales longitude by cos(latitude) so shapes keep their real proportions", () => {
    // 0.01° of longitude at 60°N is half as wide as 0.01° of latitude.
    const box: GeoPolygon = { type: "Polygon", coordinates: [ring([[10, 60], [10.01, 60], [10.01, 60.01], [10, 60.01]])] };
    const p = fitProjection([box], { width: 400, height: 400, padding: 0 })!;
    const width = p.project(10.01, 60)[0] - p.project(10, 60)[0];
    const height = p.project(10, 60)[1] - p.project(10, 60.01)[1];
    expect(width / height).toBeCloseTo(Math.cos((60.005 * Math.PI) / 180), 3);
  });

  it("draws closed paths and covers zone plus sub-zones", () => {
    const p = fitProjection([DEMO_BB, DOWNTOWN], { width: 480, height: 260 })!;
    const path = polygonPath(SQUARE, fitProjection([SQUARE], { width: 200, height: 200, padding: 0 })!);
    expect(path).toBe("M0 150 L200 150 L200 50 L0 50 Z");
    expect(polygonPath(DOWNTOWN, p).startsWith("M")).toBe(true);
    expect(boundsOf([DEMO_BB, DOWNTOWN])).toEqual({ minLng: 55.255, maxLng: 55.285, minLat: 25.185, maxLat: 25.2 });
    expect(fitProjection([], { width: 10, height: 10 })).toBeNull();
  });
});

describe("sub-zone containment (mirrors SubZoneContainment)", () => {
  it("finds the demo sub-zone inside its zone", () => {
    expect(firstVertexOutside(DEMO_BB, DOWNTOWN)).toBeNull();
  });

  it("returns the first vertex outside", () => {
    const outside: GeoPolygon = { type: "Polygon", coordinates: [ring([[55.27, 25.193], [55.3, 25.193], [55.28, 25.199]])] };
    expect(firstVertexOutside(DEMO_BB, outside)).toEqual([55.3, 25.193]);
  });

  it("counts the boundary as inside and holes as outside", () => {
    expect(containsPoint(SQUARE, 2, 0.5)).toBe(true);
    const withHole: GeoPolygon = {
      type: "Polygon",
      coordinates: [SQUARE.coordinates[0], ring([[0.5, 0.25], [1.5, 0.25], [1.5, 0.75], [0.5, 0.75]])],
    };
    expect(containsPoint(withHole, 1, 0.5)).toBe(false);
    expect(containsPoint(withHole, 0.25, 0.5)).toBe(true);
    expect(containsPoint(withHole, 0.5, 0.5)).toBe(true);
  });
});

describe("zone forms", () => {
  it("upper-cases codes and turns the GeoJSON text into the polygon payload", () => {
    const values = {
      ...zoneToFormValues(null),
      code: "demo_jvc",
      name: { ar: "قرية جميرا الدائرية", en: "JVC" },
      polygon: JSON.stringify(SQUARE),
      default_travel_buffer_min: "20",
    };
    const result = zoneFormSchema("create").parse(values);
    expect(result.payload).toEqual({
      code: "DEMO_JVC",
      name: { ar: "قرية جميرا الدائرية", en: "JVC" },
      polygon: SQUARE,
      default_travel_buffer_min: 20,
      sort_order: 0,
      is_active: true,
    });
    // Editing never sends is_active (deactivation has its own endpoint).
    expect(zoneFormSchema("edit").parse(values).payload).not.toHaveProperty("is_active");
  });

  it("reports polygon problems as polygon.<reason>", () => {
    const values = { ...zoneToFormValues(null), code: "Z1", name: { ar: "م", en: "Z" } };
    const issue = (polygon: string) => zoneFormSchema("create").safeParse({ ...values, polygon }).error?.issues.map((i) => i.message);
    expect(issue("")).toEqual(["required"]);
    expect(issue("{")).toEqual(["polygon.json"]);
    expect(issue('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}')).toEqual(["polygon.ring_not_closed"]);
  });

  it("refuses travel buffers over 240 minutes and bad zone codes", () => {
    const values = { ...zoneToFormValues(null), name: { ar: "م", en: "Z" }, polygon: JSON.stringify(SQUARE) };
    const messages = zoneFormSchema("create")
      .safeParse({ ...values, code: "bad code", default_travel_buffer_min: "241" })
      .error?.issues.map((i) => `${i.path.join(".")}:${i.message}`);
    expect(messages).toEqual(["code:zoneCodeFormat", "default_travel_buffer_min:travelBuffer"]);
  });

  it("round-trips a stored zone through the form", () => {
    const zone = {
      id: 1,
      code: "DEMO_BB",
      name: { ar: "الخليج التجاري", en: "Business Bay" },
      is_active: true,
      polygon: DEMO_BB,
      bbox: { min_lat: 25.185, max_lat: 25.2, min_lng: 55.255, max_lng: 55.285 },
      default_travel_buffer_min: null,
      sort_order: 10,
      version: 3,
      created_at: null,
      updated_at: null,
    };
    expect(zoneFormSchema("edit").parse(zoneToFormValues(zone)).payload).toEqual({
      code: "DEMO_BB",
      name: zone.name,
      polygon: DEMO_BB,
      default_travel_buffer_min: null,
      sort_order: 10,
    });
  });

  it("validates sub-zones the same way", () => {
    const result = subZoneFormSchema.parse({
      code: "dt",
      name: { ar: "داون تاون", en: "Downtown" },
      polygon: formatPolygonText(DOWNTOWN),
      is_active: true,
      reason: "x",
    });
    expect(result.payload).toEqual({ code: "DT", name: { ar: "داون تاون", en: "Downtown" }, polygon: DOWNTOWN, is_active: true });
  });
});
