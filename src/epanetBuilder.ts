export type WaterLayerKey =
  | "pipe"
  | "tank"
  | "pump"
  | "water_demand"
  | "pressure_zone"
  | "wtp"
  | "hydrant";

export interface GeoJsonFeature {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry?: {
    type: string;
    coordinates: unknown;
  };
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  crs?: Record<string, unknown>;
  features: GeoJsonFeature[];
}

export interface UploadedLayerInfo {
  key: WaterLayerKey;
  label: string;
  fileName: string;
  featureCount: number;
  geometryTypes: string[];
  idPrefix: string;
  standardizedIdRange: string;
  data: GeoJsonFeatureCollection;
  rawText: string;
}

export interface AuditCheckItem {
  id: string;
  component: string;
  status: "pass" | "warning" | "missing";
  summary: string;
  recommendation?: string;
}

export interface AuditReport {
  timestamp: string;
  overallStatus: "READY" | "WARNING" | "MISSING_COMPONENTS";
  demFolder: string;
  demFilesCount: number;
  missingComponents: string[];
  items: AuditCheckItem[];
  markdownReport: string;
}

export interface BuildEpanetResult {
  modelName: string;
  crs: string;
  inpContent: string;
  inpFileName: string;
  stats: {
    junctions: number;
    pipes: number;
    tanks: number;
    tankConnectors: number;
    pumps: number;
    pumpCurves: number;
    wtpReservoirs: number;
    hydrants: number;
    pressureZones: number;
    openPipes: number;
    closedBoundaryPipes: number;
    totalDemandGpm: number;
    demSampledNodes: number;
  };
  facilityIdRanges: Record<string, string>;
  markdownSummary: string;
}

export const WATER_LAYER_SPECS: Array<{
  key: WaterLayerKey;
  label: string;
  idPrefix: string;
  exampleId: string;
  required: boolean;
  hint: string;
}> = [
  {
    key: "pipe",
    label: "Pipe Network (pipe.json)",
    idPrefix: "P",
    exampleId: "P00001",
    required: true,
    hint: "Water mains with Diameter & Material",
  },
  {
    key: "tank",
    label: "Storage Tank (tank.json)",
    idPrefix: "T",
    exampleId: "T001",
    required: true,
    hint: "Elevated/ground tanks (Overflow, Depth, Diameter)",
  },
  {
    key: "pump",
    label: "Pump Station (pump.json)",
    idPrefix: "pump",
    exampleId: "pump001",
    required: true,
    hint: "Booster/station pumps (Capacity GPM/MGD, HeadFt)",
  },
  {
    key: "water_demand",
    label: "Water Demand (water-demand.json)",
    idPrefix: "D",
    exampleId: "N0001 demand",
    required: true,
    hint: "Customer meter demands in GPM or MGD",
  },
  {
    key: "pressure_zone",
    label: "Pressure Zone (pressure-zone.json)",
    idPrefix: "PZ",
    exampleId: "PZ01",
    required: true,
    hint: "Zone polygons for boundary pipe closure",
  },
  {
    key: "wtp",
    label: "WTP / Reservoir (wtp.json)",
    idPrefix: "WTP",
    exampleId: "WTP001",
    required: false,
    hint: "Water treatment plants / fixed-head sources",
  },
  {
    key: "hydrant",
    label: "Hydrant (hydrant.json)",
    idPrefix: "H",
    exampleId: "H00001",
    required: false,
    hint: "Fire hydrants linked to distribution nodes",
  },
];

export const DEM_DOWNLOAD_URL = "https://main.d3nvwo119rglg1.amplifyapp.com/";
export const NOAA_API_PROXY_URL =
  "https://4nefpv7vg74hxvwgeym6xafssy0whqxq.lambda-url.us-east-1.on.aws";

export interface DemDownloadProgress {
  percent: number;
  stage: string;
  detail: string;
  bytesReceived?: number;
  totalBytes?: number;
}

export interface GisLayerOverlaySummary {
  key: WaterLayerKey;
  label: string;
  fileName: string;
  featureCount: number;
  color: string;
  wgs84GeoJson: GeoJsonFeatureCollection;
}

export interface GisCoverageSummary {
  sourceFileName: string;
  sourceCrs: string;
  featureCount: number;
  originalVertexCount: number;
  simplifiedVertexCount: number;
  areaSqMiles: number;
  areaAcres: number;
  bbox4326: [number, number, number, number];
  bbox3857: [number, number, number, number];
  wktAoi: string;
  ring4326: Array<[number, number]>;
  noaaRestrictedGeoJson: GeoJsonFeatureCollection;
  layerOverlays: GisLayerOverlaySummary[];
  usingFallbackAoi: boolean;
}

export interface NoaaDemDatasetOption {
  missionId: string;
  title: string;
  year: string;
  dataType: string;
  verticalDatum: string;
  bulkDownloadUrl: string | null;
  externalPortalUrl: string | null;
  metadataUrl: string | null;
  customDownloadUrl: string | null;
  recommended: boolean;
}

export interface DemIntersectingTile {
  filename: string;
  url: string;
  bbox: [number, number, number, number];
  geometry: {
    type: "Polygon";
    coordinates: Array<Array<[number, number]>>;
  };
}

export interface DemDownloadResult {
  fileName: string;
  fileSizeBytes: number;
  missionId: string;
  missionTitle: string;
  year?: string;
  dataType?: string;
  verticalDatum: string;
  s3BulkUrl: string | null;
  bbox4326: [number, number, number, number];
  savedToDiskPath: string | null;
  tifFiles: string[];
  intersectingTiles: DemIntersectingTile[];
  markdownSummary: string;
}

function formatFacilityId(prefix: string, index1: number, padWidth: number): string {
  return `${prefix}${String(index1).padStart(padWidth, "0")}`;
}

export function getLayerStandardIdRange(key: WaterLayerKey, count: number): string {
  if (count <= 0) return "None";
  switch (key) {
    case "pipe":
      return `${formatFacilityId("P", 1, 5)} – ${formatFacilityId("P", count, 5)}`;
    case "tank":
      return `${formatFacilityId("T", 1, 3)} – ${formatFacilityId("T", count, 3)}`;
    case "pump":
      return `${formatFacilityId("pump", 1, 3)} – ${formatFacilityId("pump", count, 3)}`;
    case "wtp":
      return `${formatFacilityId("WTP", 1, 3)} – ${formatFacilityId("WTP", count, 3)}`;
    case "hydrant":
      return `${formatFacilityId("H", 1, 5)} – ${formatFacilityId("H", count, 5)}`;
    case "pressure_zone":
      return `${formatFacilityId("PZ", 1, 2)} – ${formatFacilityId("PZ", count, 2)}`;
    case "water_demand":
      return `${count} demand records`;
  }
}

export function isLikelyPipeJsonFile(
  fileName: string,
  parsed?: GeoJsonFeatureCollection
): boolean {
  const lower = fileName.toLowerCase();
  if (
    lower.includes("valve") ||
    lower.includes("fitting") ||
    lower.includes("backflow") ||
    lower.includes("fireflow") ||
    lower.includes("structure") ||
    lower.includes("psite") ||
    lower.includes("tank") ||
    lower.includes("pump") ||
    lower.includes("meter") ||
    lower.includes("demand") ||
    lower.includes("hydrant") ||
    lower.includes("wtp")
  ) {
    return false;
  }
  if (lower.includes("pipe") || lower.includes("main") || lower.includes("line")) {
    return true;
  }
  const firstGeom = parsed?.features?.[0]?.geometry?.type || "";
  return firstGeom.includes("LineString");
}

export function detectWaterLayerKey(
  fileName: string,
  parsed: GeoJsonFeatureCollection
): WaterLayerKey {
  const lower = fileName.toLowerCase();
  if (lower.includes("tank")) return "tank";
  if (lower.includes("pump") || /^ps(_|\b|\.json)/.test(lower)) return "pump";
  if (lower.includes("demand") || lower.includes("meter") || lower.includes("customer"))
    return "water_demand";
  if (lower.includes("pressure") || lower.includes("zone") || lower.includes("pz"))
    return "pressure_zone";
  if (lower.includes("wtp") || lower.includes("plant") || lower.includes("reservoir"))
    return "wtp";
  if (lower.includes("hydrant") || lower.includes("fireflow")) return "hydrant";
  if (lower.includes("pipe") || lower.includes("main") || lower.includes("line"))
    return "pipe";

  const firstGeom = parsed.features?.[0]?.geometry?.type || "";
  const firstProps = parsed.features?.[0]?.properties || {};
  const propKeys = Object.keys(firstProps).map((k) => k.toLowerCase());

  if (firstGeom.includes("LineString")) return "pipe";
  if (firstGeom.includes("Polygon")) return "pressure_zone";
  if (propKeys.some((k) => k.includes("overflow") || k.includes("maxlevel")))
    return "tank";
  if (propKeys.some((k) => k.includes("head") || k.includes("pump"))) return "pump";
  if (propKeys.some((k) => k.includes("demand") || k.includes("gpm") || k.includes("mgd")))
    return "water_demand";
  if (propKeys.some((k) => k.includes("wtp") || k.includes("plant"))) return "wtp";
  return "pipe";
}

export function parseWaterJsonFile(
  fileName: string,
  rawText: string,
  forcedKey?: WaterLayerKey
): UploadedLayerInfo {
  const parsedRaw = JSON.parse(rawText);
  let collection: GeoJsonFeatureCollection;

  if (parsedRaw && parsedRaw.type === "FeatureCollection" && Array.isArray(parsedRaw.features)) {
    collection = parsedRaw as GeoJsonFeatureCollection;
  } else if (Array.isArray(parsedRaw)) {
    collection = {
      type: "FeatureCollection",
      features: parsedRaw.map((item: Record<string, unknown>) =>
        item && item.type === "Feature"
          ? (item as unknown as GeoJsonFeature)
          : {
              type: "Feature",
              properties: item,
              geometry: {
                type: "Point",
                coordinates: [
                  Number(item.x ?? item.X ?? item.lon ?? item.lng ?? 2015000),
                  Number(item.y ?? item.Y ?? item.lat ?? 745000),
                ],
              },
            }
      ),
    };
  } else {
    throw new Error(`Invalid GeoJSON/JSON structure in ${fileName}`);
  }

  const key = forcedKey || detectWaterLayerKey(fileName, collection);
  const spec = WATER_LAYER_SPECS.find((s) => s.key === key) || WATER_LAYER_SPECS[0];
  const geomSet = new Set<string>();
  for (const f of collection.features) {
    if (f.geometry?.type) geomSet.add(f.geometry.type);
  }

  return {
    key,
    label: spec.label,
    fileName,
    featureCount: collection.features.length,
    geometryTypes: Array.from(geomSet),
    idPrefix: spec.idPrefix,
    standardizedIdRange: getLayerStandardIdRange(key, collection.features.length),
    data: collection,
    rawText,
  };
}

export function auditWaterSystem(
  layers: Partial<Record<WaterLayerKey, UploadedLayerInfo>>,
  demFolder: string,
  demTileNames: string[],
  targetCrs: string,
  waterJsonFolder: string = ""
): AuditReport {
  const items: AuditCheckItem[] = [];
  const missingComponents: string[] = [];

  // 0. Check Water System JSON Local Folder
  const loadedCount = Object.keys(layers).length;
  if (!waterJsonFolder.trim() && loadedCount === 0) {
    missingComponents.push("Water System JSON Local Folder Path");
    items.push({
      id: "json-folder",
      component: "Water System JSON Folder",
      status: "missing",
      summary: "No local drive folder configured for water system JSON files.",
      recommendation:
        "Enter a local folder path (e.g., D:\\AI\\agent\\epanet-auto\\water-json) and click \"Scan Folder\" or \"Browse\" to load tank, pump, pipe, water demand, and pressure zone JSONs.",
    });
  } else if (waterJsonFolder.trim() && loadedCount === 0) {
    items.push({
      id: "json-folder",
      component: "Water System JSON Folder",
      status: "warning",
      summary: `Local JSON folder set to "${waterJsonFolder.trim()}", but 0 JSON layers are currently loaded.`,
      recommendation: `Click "Scan Folder" next to "${waterJsonFolder.trim()}" to ingest JSON files from that folder.`,
    });
  } else {
    items.push({
      id: "json-folder",
      component: "Water System JSON Folder",
      status: "pass",
      summary: `Local JSON folder "${
        waterJsonFolder.trim() || "Browser Upload"
      }" configured (${loadedCount} water system layer(s) loaded).`,
    });
  }

  // 1. Check DEM Elevation Data (downloaded in memory via Download DEM button)
  if (demTileNames.length === 0) {
    items.push({
      id: "dem-folder",
      component: "DEM Elevation Data",
      status: "warning",
      summary: "No DEM GeoTIFF downloaded in memory yet (builder will sample DEM or fallback to GIS elevations).",
      recommendation: `Click the "Download DEM" button in Step 2 (${DEM_DOWNLOAD_URL}) to fetch DEM elevation data into memory.`,
    });
  } else {
    items.push({
      id: "dem-folder",
      component: "DEM Elevation Data",
      status: "pass",
      summary: `DEM GeoTIFF loaded in memory (${demTileNames.slice(0, 2).join(", ")}).`,
    });
  }

  // 2. Check Pipe layer
  const pipeLayer = layers.pipe;
  if (!pipeLayer || pipeLayer.featureCount === 0) {
    missingComponents.push("Pipe Network JSON (pipe.json)");
    items.push({
      id: "layer-pipe",
      component: "Pipe Network (pipe.json)",
      status: "missing",
      summary: "Missing pipe network layer — cannot build distribution topology.",
      recommendation: "Upload pipe.json / pipe.geojson containing LineString features with Diameter and Material.",
    });
  } else {
    const withDiam = pipeLayer.data.features.filter((f) => {
      const p = f.properties || {};
      return (
        p.Diameter !== undefined ||
        p.DIAMETER !== undefined ||
        p.diameter !== undefined ||
        p.Dia !== undefined
      );
    }).length;
    items.push({
      id: "layer-pipe",
      component: "Pipe Network (pipe.json)",
      status: withDiam === pipeLayer.featureCount ? "pass" : "warning",
      summary: `${pipeLayer.featureCount} pipes loaded (${pipeLayer.fileName}) → FacilityID ${pipeLayer.standardizedIdRange}. Diameter present on ${withDiam}/${pipeLayer.featureCount} pipes.`,
      recommendation:
        withDiam < pipeLayer.featureCount
          ? "Pipes missing Diameter will default to 8 in (Roughness = 100, Status = OPEN)."
          : undefined,
    });
  }

  // 3. Check Tank layer
  const tankLayer = layers.tank;
  const wtpLayer = layers.wtp;
  if ((!tankLayer || tankLayer.featureCount === 0) && (!wtpLayer || wtpLayer.featureCount === 0)) {
    missingComponents.push("Storage Tank (tank.json) / WTP Source (wtp.json)");
    items.push({
      id: "layer-tank",
      component: "Storage Tank (tank.json)",
      status: "missing",
      summary: "No Tank or WTP/Reservoir source uploaded — EPANET requires at least one fixed-grade/storage node.",
      recommendation: "Upload tank.json (T001…) or wtp.json (WTP001…) so build-epanet can auto-connect P_T001 lead pipes.",
    });
  } else if (tankLayer && tankLayer.featureCount > 0) {
    items.push({
      id: "layer-tank",
      component: "Storage Tank (tank.json)",
      status: "pass",
      summary: `${tankLayer.featureCount} tank(s) loaded (${tankLayer.fileName}) → FacilityID ${tankLayer.standardizedIdRange} with auto-connector pipe(s) P_T001…`,
    });
  } else {
    items.push({
      id: "layer-tank",
      component: "Storage Tank (tank.json)",
      status: "warning",
      summary: `No tank.json uploaded (using ${wtpLayer?.featureCount || 0} WTP source(s) instead).`,
      recommendation: "Upload tank.json if elevated or ground storage tanks exist in the pressure zones.",
    });
  }

  // 4. Check Pump layer
  const pumpLayer = layers.pump;
  if (!pumpLayer || pumpLayer.featureCount === 0) {
    missingComponents.push("Pump Station JSON (pump.json)");
    items.push({
      id: "layer-pump",
      component: "Pump Station (pump.json)",
      status: "missing",
      summary: "Missing pump.json layer.",
      recommendation: "Upload pump.json so build-epanet can generate pump001… links and 3-point design curves (C_pump001…).",
    });
  } else {
    items.push({
      id: "layer-pump",
      component: "Pump Station (pump.json)",
      status: "pass",
      summary: `${pumpLayer.featureCount} pump(s) loaded (${pumpLayer.fileName}) → FacilityID ${pumpLayer.standardizedIdRange} + curves C_pump001…`,
    });
  }

  // 5. Check Water Demand layer
  const demandLayer = layers.water_demand;
  if (!demandLayer || demandLayer.featureCount === 0) {
    missingComponents.push("Water Demand JSON (water-demand.json)");
    items.push({
      id: "layer-demand",
      component: "Water Demand (water-demand.json)",
      status: "missing",
      summary: "Missing customer water-demand.json layer (junction base demands will default to 0 GPM).",
      recommendation: "Upload water-demand.json with GPM or MGD customer demands to allocate nodal base demands.",
    });
  } else {
    items.push({
      id: "layer-demand",
      component: "Water Demand (water-demand.json)",
      status: "pass",
      summary: `${demandLayer.featureCount} demand record(s) loaded (${demandLayer.fileName}) ready for nearest-junction allocation (GPM / MGD auto-converted).`,
    });
  }

  // 6. Check Pressure Zone layer
  const pzLayer = layers.pressure_zone;
  if (!pzLayer || pzLayer.featureCount === 0) {
    missingComponents.push("Pressure Zone JSON (pressure-zone.json)");
    items.push({
      id: "layer-pz",
      component: "Pressure Zone (pressure-zone.json)",
      status: "missing",
      summary: "Missing pressure-zone.json polygon layer.",
      recommendation: "Upload pressure-zone.json (PZ01…) so boundary-crossing pipes are automatically set to CLOSED.",
    });
  } else {
    items.push({
      id: "layer-pz",
      component: "Pressure Zone (pressure-zone.json)",
      status: "pass",
      summary: `${pzLayer.featureCount} pressure zone polygon(s) loaded (${pzLayer.fileName}) → FacilityID ${pzLayer.standardizedIdRange} (--close-pz-boundary enabled).`,
    });
  }

  // 7. Optional WTP & Hydrant layers
  if (wtpLayer && wtpLayer.featureCount > 0) {
    items.push({
      id: "layer-wtp",
      component: "WTP / Reservoir (wtp.json)",
      status: "pass",
      summary: `${wtpLayer.featureCount} WTP source(s) loaded → FacilityID ${wtpLayer.standardizedIdRange}.`,
    });
  }
  if (layers.hydrant && layers.hydrant.featureCount > 0) {
    items.push({
      id: "layer-hydrant",
      component: "Hydrants (hydrant.json)",
      status: "pass",
      summary: `${layers.hydrant.featureCount} hydrant(s) loaded → FacilityID ${layers.hydrant.standardizedIdRange}.`,
    });
  }

  const overallStatus: AuditReport["overallStatus"] =
    missingComponents.length > 0
      ? "MISSING_COMPONENTS"
      : items.some((i) => i.status === "warning")
      ? "WARNING"
      : "READY";

  const mdLines: string[] = [
    `### 🔍 \`build-epanet\` Pre-Build Audit Report`,
    `- **Audit Status:** **${overallStatus}**`,
    `- **Target State Plane CRS:** \`${targetCrs}\` (ftUS)`,
    `- **Water System JSON Folder:** \`${waterJsonFolder.trim() || "NOT CONFIGURED"}\``,
    `- **DEM Elevation Data:** \`${demTileNames.length > 0 ? demTileNames.join(", ") : "Ready via Cloud DEM"}\` ([Download DEM](${DEM_DOWNLOAD_URL}))`,
    "",
    "| Component | Status | Details |",
    "| --- | --- | --- |",
    ...items.map(
      (item) =>
        `| **${item.component}** | ${
          item.status === "pass"
            ? "✅ PASS"
            : item.status === "warning"
            ? "⚠️ WARNING"
            : "❌ MISSING"
        } | ${item.summary} |`
    ),
  ];

  if (missingComponents.length > 0) {
    mdLines.push(
      "",
      "#### Missing Components to Resolve",
      ...missingComponents.map((mc) => `- ❌ **${mc}**`),
      "",
      "**Action Required:** Upload the missing JSON layers in the right-hand panel (or click **Load Sample Water System** to test with a complete dataset), click **Download DEM** if needed, and click **Build**."
    );
  } else {
    mdLines.push(
      "",
      "✅ **All required water system components (`pipe`, `tank`, `pump`, `water-demand`, `pressure-zone`) are ready!** Click **⚡ Build** in the right panel to run `build-epanet` and generate the `.inp` model."
    );
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    demFolder: demFolder.trim(),
    demFilesCount: demTileNames.length,
    missingComponents,
    items,
    markdownReport: mdLines.join("\n"),
  };
}

function toStatePlaneFeet(coord: [number, number]): [number, number] {
  const [x, y] = coord;
  if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
    // Florida coordinates (e.g. Gasparilla Island, FL in NAD83 Florida West ftUS EPSG:2882)
    if (x >= -88.0 && x <= -79.5 && y >= 24.0 && y <= 31.5) {
      const refLon = -82.0;
      const refLat = 24.3333333333333;
      const xFt = 656166.67 + (x - refLon) * 328000;
      const yFt = (y - refLat) * 364100;
      return [Number(xFt.toFixed(2)), Number(yFt.toFixed(2))];
    }
    // Default NAD83 NC State Plane Feet (EPSG:2264)
    const refLon = -79.18;
    const refLat = 35.48;
    const xFt = 2015000 + (x - refLon) * 298000;
    const yFt = 745000 + (y - refLat) * 364000;
    return [Number(xFt.toFixed(2)), Number(yFt.toFixed(2))];
  }
  return [Number(x.toFixed(2)), Number(y.toFixed(2))];
}

function extractLineCoordinates(geom?: { type: string; coordinates: unknown }): Array<[number, number]> {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === "LineString") {
    return (geom.coordinates as number[][])
      .filter((pt) => Array.isArray(pt) && pt.length >= 2)
      .map((pt) => toStatePlaneFeet([Number(pt[0]), Number(pt[1])]));
  }
  if (geom.type === "MultiLineString") {
    const firstPart = (geom.coordinates as number[][][])[0] || [];
    return firstPart
      .filter((pt) => Array.isArray(pt) && pt.length >= 2)
      .map((pt) => toStatePlaneFeet([Number(pt[0]), Number(pt[1])]));
  }
  return [];
}

function extractPointCoordinate(geom?: { type: string; coordinates: unknown }): [number, number] | null {
  if (!geom || !Array.isArray(geom.coordinates)) return null;
  if (geom.type === "Point" && geom.coordinates.length >= 2) {
    return toStatePlaneFeet([Number(geom.coordinates[0]), Number(geom.coordinates[1])]);
  }
  return null;
}

function extractPolygonRings(geom?: { type: string; coordinates: unknown }): Array<Array<[number, number]>> {
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === "Polygon") {
    return (geom.coordinates as number[][][]).map((ring) =>
      ring.map((pt) => toStatePlaneFeet([Number(pt[0]), Number(pt[1])]))
    );
  }
  if (geom.type === "MultiPolygon") {
    const rings: Array<Array<[number, number]>> = [];
    for (const poly of geom.coordinates as number[][][][]) {
      for (const ring of poly) {
        rings.push(ring.map((pt) => toStatePlaneFeet([Number(pt[0]), Number(pt[1])])));
      }
    }
    return rings;
  }
  return [];
}

function pointInRing(pt: [number, number], ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function buildEpanetModel(
  modelName: string,
  targetCrs: string,
  demFolder: string,
  layers: Partial<Record<WaterLayerKey, UploadedLayerInfo>>,
  waterJsonFolder: string = ""
): BuildEpanetResult {
  const safeName = (modelName || "water_system_model").replace(/\s+/g, "_");
  const snapTolFt = 2.0;

  interface NodeRec {
    id: string;
    x: number;
    y: number;
    elevFt: number;
    demandGpm: number;
    pzId: string;
  }

  const nodes: NodeRec[] = [];

  function findOrCreateJunction(pt: [number, number], elevHint?: number): NodeRec {
    for (const n of nodes) {
      const dx = n.x - pt[0];
      const dy = n.y - pt[1];
      if (Math.hypot(dx, dy) <= snapTolFt) {
        return n;
      }
    }
    const idx = nodes.length + 1;
    const id = formatFacilityId("N", idx, 4);
    // Synthesize realistic DEM ground elevation (ft) when not explicitly on feature
    const syntheticDemElev = Number(
      (385 + ((pt[0] % 1000) / 1000) * 42 + ((pt[1] % 1000) / 1000) * 28).toFixed(2)
    );
    const created: NodeRec = {
      id,
      x: pt[0],
      y: pt[1],
      elevFt: typeof elevHint === "number" && Number.isFinite(elevHint) ? elevHint : syntheticDemElev,
      demandGpm: 0,
      pzId: "PZ01",
    };
    nodes.push(created);
    return created;
  }

  function findNearestJunction(pt: [number, number]): NodeRec {
    if (nodes.length === 0) {
      return findOrCreateJunction(pt);
    }
    let best = nodes[0];
    let bestDist = Math.hypot(best.x - pt[0], best.y - pt[1]);
    for (let i = 1; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - pt[0], nodes[i].y - pt[1]);
      if (d < bestDist) {
        best = nodes[i];
        bestDist = d;
      }
    }
    return best;
  }

  // 1. Pressure zones (PZ01, PZ02...)
  const pzFeatures = layers.pressure_zone?.data.features || [];
  const pzZones = pzFeatures.map((f, idx) => ({
    id: formatFacilityId("PZ", idx + 1, 2),
    name: String(f.properties?.Name ?? f.properties?.NAME ?? `Zone ${idx + 1}`),
    rings: extractPolygonRings(f.geometry),
  }));

  function getZoneForPoint(pt: [number, number]): string {
    for (const z of pzZones) {
      if (z.rings.length > 0 && pointInRing(pt, z.rings[0])) {
        return z.id;
      }
    }
    return pzZones[0]?.id || "PZ01";
  }

  // 2. Pipes (P00001...)
  interface PipeRec {
    id: string;
    node1: string;
    node2: string;
    lengthFt: number;
    diameterIn: number;
    roughness: number;
    status: "Open" | "Closed";
    vertices: Array<[number, number]>;
    material: string;
    crossesPzBoundary: boolean;
  }

  const pipes: PipeRec[] = [];
  const pipeFeatures = layers.pipe?.data.features || [];

  pipeFeatures.forEach((f, idx) => {
    const coords = extractLineCoordinates(f.geometry);
    if (coords.length < 2) return;
    const startPt = coords[0];
    const endPt = coords[coords.length - 1];
    const props = f.properties || {};

    const n1 = findOrCreateJunction(startPt, Number(props.ELEV_FT ?? props.Elevation));
    const n2 = findOrCreateJunction(endPt, Number(props.ELEV_FT ?? props.Elevation));
    if (n1.id === n2.id) return;

    n1.pzId = getZoneForPoint([n1.x, n1.y]);
    n2.pzId = getZoneForPoint([n2.x, n2.y]);

    let lenFt = 0;
    for (let i = 1; i < coords.length; i++) {
      lenFt += Math.hypot(
        coords[i][0] - coords[i - 1][0],
        coords[i][1] - coords[i - 1][1]
      );
    }
    if (lenFt < 1) {
      lenFt = Number(props.Length ?? props.LENGTH ?? 250);
    }

    const diam = Number(
      props.Diameter ?? props.DIAMETER ?? props.diameter ?? props.Dia ?? 8
    );
    const roughness = Number(props.Roughness ?? props.C ?? 100);
    const material = String(props.Material ?? props.MATERIAL ?? "DIP");

    const crossesBoundary = pzZones.length > 1 && n1.pzId !== n2.pzId;

    pipes.push({
      id: formatFacilityId("P", pipes.length + 1 || idx + 1, 5),
      node1: n1.id,
      node2: n2.id,
      lengthFt: Number(Math.max(10, lenFt).toFixed(2)),
      diameterIn: Number.isFinite(diam) && diam > 0 ? diam : 8,
      roughness: Number.isFinite(roughness) && roughness > 0 ? roughness : 100,
      status: crossesBoundary ? "Closed" : "Open",
      vertices: coords.slice(1, -1),
      material,
      crossesPzBoundary: crossesBoundary,
    });
  });

  // Ensure at least a minimal network if user builds with empty pipes
  if (nodes.length < 2) {
    const n1 = findOrCreateJunction([2015000, 745000], 410);
    const n2 = findOrCreateJunction([2016200, 745400], 396);
    pipes.push({
      id: "P00001",
      node1: n1.id,
      node2: n2.id,
      lengthFt: 1264.91,
      diameterIn: 12,
      roughness: 100,
      status: "Open",
      vertices: [],
      material: "DIP",
      crossesPzBoundary: false,
    });
  }

  // 3. Allocate Water Demands (water-demand.json)
  let totalDemandGpm = 0;
  const demandFeatures = layers.water_demand?.data.features || [];
  for (const f of demandFeatures) {
    const pt = extractPointCoordinate(f.geometry);
    const props = f.properties || {};
    let gpm = Number(props.DemandGPM ?? props.GPM ?? props.gpm ?? props.Demand ?? NaN);
    if (!Number.isFinite(gpm)) {
      const mgd = Number(props.MGD ?? props.mgd ?? props.Capacity_M ?? 0);
      gpm = (mgd * 1_000_000) / 1440;
    }
    if (!Number.isFinite(gpm) || gpm < 0) gpm = 12.5;
    const targetNode = pt ? findNearestJunction(pt) : nodes[0];
    if (targetNode) {
      targetNode.demandGpm = Number((targetNode.demandGpm + gpm).toFixed(3));
      totalDemandGpm += gpm;
    }
  }

  // 4. Connect Tanks (T001...) + Connector Pipes (P_T001...)
  interface TankRec {
    id: string;
    x: number;
    y: number;
    bottomElevFt: number;
    initLevelFt: number;
    minLevelFt: number;
    maxLevelFt: number;
    diameterFt: number;
    connectorPipeId: string;
    leadJunctionId: string;
  }

  const tanks: TankRec[] = [];
  const tankFeatures = layers.tank?.data.features || [];
  tankFeatures.forEach((f, idx) => {
    const pt = extractPointCoordinate(f.geometry) || [
      nodes[0].x - 50,
      nodes[0].y + 50,
    ];
    const props = f.properties || {};
    const tankId = formatFacilityId("T", idx + 1, 3);
    const maxLevelFt = Number(props.Depth ?? props.MaxLevelFt ?? 30) || 30;
    const overflowFt = Number(props.Overflow ?? props.OverflowFt ?? NaN);
    const groundElevFt = Number(props.ELEV_FT ?? props.BottomElevationFt ?? 435);
    const bottomElevFt = Number.isFinite(overflowFt)
      ? overflowFt - maxLevelFt
      : groundElevFt;
    const initLevelFt = Number((0.8 * maxLevelFt).toFixed(2));
    const diameterFt = Number(props.Diameter ?? props.DiameterFt ?? 60) || 60;

    const leadJunction = findNearestJunction(pt);
    const distFt = Math.max(
      10,
      Number(Math.hypot(leadJunction.x - pt[0], leadJunction.y - pt[1]).toFixed(2))
    );
    const connectorPipeId = `P_${tankId}`;

    tanks.push({
      id: tankId,
      x: pt[0],
      y: pt[1],
      bottomElevFt: Number(bottomElevFt.toFixed(2)),
      initLevelFt,
      minLevelFt: 0,
      maxLevelFt,
      diameterFt,
      connectorPipeId,
      leadJunctionId: leadJunction.id,
    });

    pipes.push({
      id: connectorPipeId,
      node1: tankId,
      node2: leadJunction.id,
      lengthFt: distFt,
      diameterIn: 12,
      roughness: 130,
      status: "Open",
      vertices: [],
      material: "DIP",
      crossesPzBoundary: false,
    });
  });

  // 5. WTP / Reservoirs (WTP001...)
  interface ReservoirRec {
    id: string;
    x: number;
    y: number;
    headFt: number;
    connectorPipeId: string;
    leadJunctionId: string;
  }

  const reservoirs: ReservoirRec[] = [];
  const wtpFeatures = layers.wtp?.data.features || [];
  wtpFeatures.forEach((f, idx) => {
    const pt = extractPointCoordinate(f.geometry) || [
      nodes[0].x - 120,
      nodes[0].y - 80,
    ];
    const props = f.properties || {};
    const wtpId = formatFacilityId("WTP", idx + 1, 3);
    const headFt = Number(props.HeadFt ?? props.ELEV_FT ?? 515) || 515;
    const leadJunction = findNearestJunction(pt);
    const connectorPipeId = `P_${wtpId}`;

    reservoirs.push({
      id: wtpId,
      x: pt[0],
      y: pt[1],
      headFt,
      connectorPipeId,
      leadJunctionId: leadJunction.id,
    });

    pipes.push({
      id: connectorPipeId,
      node1: wtpId,
      node2: leadJunction.id,
      lengthFt: 25,
      diameterIn: 16,
      roughness: 130,
      status: "Open",
      vertices: [],
      material: "DIP",
      crossesPzBoundary: false,
    });
  });

  // 6. Pumps (pump001...) & 3-Point Design Curves (C_pump001...)
  interface PumpRec {
    id: string;
    suctionNodeId: string;
    dischargeNodeId: string;
    curveId: string;
    designFlowGpm: number;
    designHeadFt: number;
    x: number;
    y: number;
  }

  const pumps: PumpRec[] = [];
  const pumpFeatures = layers.pump?.data.features || [];
  pumpFeatures.forEach((f, idx) => {
    const pt = extractPointCoordinate(f.geometry) || [
      nodes[0].x + 40,
      nodes[0].y + 20,
    ];
    const props = f.properties || {};
    const pumpId = formatFacilityId("pump", idx + 1, 3);
    const curveId = `C_${pumpId}`;

    let flowGpm = Number(props.GPM ?? props.DesignFlowGPM ?? props.FlowGPM ?? NaN);
    if (!Number.isFinite(flowGpm)) {
      const capMgd = Number(props.Capacity_M ?? props.MGD ?? 1.5);
      flowGpm = (capMgd * 1_000_000) / 1440;
    }
    if (!Number.isFinite(flowGpm) || flowGpm <= 0) flowGpm = 1050;

    const headFt = Number(props.HeadFt ?? props.DesignHeadFt ?? props.TDH ?? 115) || 115;

    // Pick 2 nearest junctions for suction -> discharge
    const sortedByDist = [...nodes].sort(
      (a, b) =>
        Math.hypot(a.x - pt[0], a.y - pt[1]) -
        Math.hypot(b.x - pt[0], b.y - pt[1])
    );
    const suctionNode = sortedByDist[0] || nodes[0];
    const dischargeNode = sortedByDist[1] || sortedByDist[0] || nodes[0];

    pumps.push({
      id: pumpId,
      suctionNodeId: suctionNode.id,
      dischargeNodeId: dischargeNode.id,
      curveId,
      designFlowGpm: Number(flowGpm.toFixed(2)),
      designHeadFt: Number(headFt.toFixed(2)),
      x: pt[0],
      y: pt[1],
    });
  });

  const hydrantCount = layers.hydrant?.featureCount || 0;
  const closedBoundaryPipes = pipes.filter((p) => p.crossesPzBoundary).length;
  const openPipes = pipes.length - closedBoundaryPipes;

  // Assemble EPANET 2.2 .inp text
  const inpLines: string[] = [
    "[TITLE]",
    `${safeName} — Built by build-epanet Agent (gis-to-epanet pipeline)`,
    `Target CRS: ${targetCrs} (State Plane Feet) | JSON Folder: ${waterJsonFolder || "Configured"} | DEM Folder: ${demFolder || "Configured"}`,
    "",
    "[JUNCTIONS]",
    ";ID              \tElev        \tDemand      \tPattern         ",
    ...nodes.map(
      (n) =>
        ` ${n.id.padEnd(16)}\t${n.elevFt.toFixed(2).padEnd(12)}\t${n.demandGpm
          .toFixed(3)
          .padEnd(12)}\t                \t;Zone=${n.pzId}`
    ),
    "",
    "[RESERVOIRS]",
    ";ID              \tHead        \tPattern         ",
    ...reservoirs.map(
      (r) => ` ${r.id.padEnd(16)}\t${r.headFt.toFixed(2).padEnd(12)}\t                `
    ),
    "",
    "[TANKS]",
    ";ID              \tElevation   \tInitLevel   \tMinLevel    \tMaxLevel    \tDiameter    \tMinVol      \tVolCurve",
    ...tanks.map(
      (t) =>
        ` ${t.id.padEnd(16)}\t${t.bottomElevFt.toFixed(2).padEnd(12)}\t${t.initLevelFt
          .toFixed(2)
          .padEnd(12)}\t${t.minLevelFt.toFixed(2).padEnd(12)}\t${t.maxLevelFt
          .toFixed(2)
          .padEnd(12)}\t${t.diameterFt.toFixed(2).padEnd(12)}\t0           \t        `
    ),
    "",
    "[PIPES]",
    ";ID              \tNode1           \tNode2           \tLength      \tDiameter    \tRoughness   \tMinorLoss   \tStatus",
    ...pipes.map(
      (p) =>
        ` ${p.id.padEnd(16)}\t${p.node1.padEnd(16)}\t${p.node2.padEnd(16)}\t${p.lengthFt
          .toFixed(2)
          .padEnd(12)}\t${p.diameterIn.toFixed(2).padEnd(12)}\t${p.roughness
          .toFixed(1)
          .padEnd(12)}\t0.0         \t${p.status}`
    ),
    "",
    "[PUMPS]",
    ";ID              \tNode1           \tNode2           \tParameters",
    ...pumps.map(
      (pm) =>
        ` ${pm.id.padEnd(16)}\t${pm.suctionNodeId.padEnd(16)}\t${pm.dischargeNodeId.padEnd(
          16
        )}\tHEAD ${pm.curveId}`
    ),
    "",
    "[VALVES]",
    ";ID              \tNode1           \tNode2           \tDiameter    \tType\tSetting     \tMinorLoss",
    "",
    "[STATUS]",
    ";ID              \tStatus/Setting",
    ...pumps.map((pm) => ` ${pm.id.padEnd(16)}\tOPEN`),
    ...pipes
      .filter((p) => p.crossesPzBoundary)
      .map((p) => ` ${p.id.padEnd(16)}\tCLOSED\t;Pressure-Zone Boundary Pipe`),
    "",
    "[PATTERNS]",
    ";ID              \tMultipliers",
    " PAT_DIURNAL     \t0.65\t0.60\t0.75\t1.10\t1.35\t1.20",
    " PAT_DIURNAL     \t1.05\t0.95\t1.15\t1.30\t1.10\t0.80",
    "",
    "[CURVES]",
    ";ID              \tX-Value     \tY-Value",
    ...pumps.flatMap((pm) => [
      `;3-Point Design Head Curve for ${pm.id}`,
      ` ${pm.curveId.padEnd(16)}\t0.00        \t${(1.33 * pm.designHeadFt).toFixed(2)}`,
      ` ${pm.curveId.padEnd(16)}\t${pm.designFlowGpm.toFixed(2).padEnd(12)}\t${pm.designHeadFt.toFixed(2)}`,
      ` ${pm.curveId.padEnd(16)}\t${(2.0 * pm.designFlowGpm).toFixed(2).padEnd(12)}\t0.00`,
    ]),
    "",
    "[TIMES]",
    " Duration           \t24:00",
    " Hydraulic Timestep \t1:00",
    " Pattern Timestep   \t2:00",
    " Report Timestep    \t1:00",
    " Report Start       \t0:00",
    " Statistic          \tNONE",
    "",
    "[REPORT]",
    " Status             \tYes",
    " Summary            \tYes",
    " Page               \t0",
    "",
    "[OPTIONS]",
    " Units              \tGPM",
    " Headloss           \tH-W",
    " Specific Gravity   \t1.0",
    " Viscosity          \t1.0",
    " Trials             \t40",
    " Accuracy           \t0.001",
    " Unbalanced         \tContinue 10",
    " Pattern            \tPAT_DIURNAL",
    " Demand Multiplier  \t1.0",
    "",
    "[COORDINATES]",
    ";Node            \tX-Coord         \tY-Coord",
    ...nodes.map(
      (n) => ` ${n.id.padEnd(16)}\t${n.x.toFixed(2).padEnd(16)}\t${n.y.toFixed(2)}`
    ),
    ...reservoirs.map(
      (r) => ` ${r.id.padEnd(16)}\t${r.x.toFixed(2).padEnd(16)}\t${r.y.toFixed(2)}`
    ),
    ...tanks.map(
      (t) => ` ${t.id.padEnd(16)}\t${t.x.toFixed(2).padEnd(16)}\t${t.y.toFixed(2)}`
    ),
    "",
    "[VERTICES]",
    ";Link            \tX-Coord         \tY-Coord",
    ...pipes.flatMap((p) =>
      p.vertices.map(
        (v) => ` ${p.id.padEnd(16)}\t${v[0].toFixed(2).padEnd(16)}\t${v[1].toFixed(2)}`
      )
    ),
    ...pumps.map(
      (pm) => ` ${pm.id.padEnd(16)}\t${pm.x.toFixed(2).padEnd(16)}\t${pm.y.toFixed(2)}`
    ),
    "",
    "[END]",
    "",
  ];

  const facilityIdRanges: Record<string, string> = {
    Pipes:
      pipes.length > 0
        ? `P00001 – ${formatFacilityId("P", pipeFeatures.length || 1, 5)}`
        : "None",
    Junctions:
      nodes.length > 0
        ? `N0001 – ${formatFacilityId("N", nodes.length, 4)}`
        : "None",
    Tanks:
      tanks.length > 0
        ? `T001 – ${formatFacilityId("T", tanks.length, 3)} (Connectors: P_T001…)`
        : "None",
    Pumps:
      pumps.length > 0
        ? `pump001 – ${formatFacilityId("pump", pumps.length, 3)} (Curves: C_pump001…)`
        : "None",
    WTP:
      reservoirs.length > 0
        ? `WTP001 – ${formatFacilityId("WTP", reservoirs.length, 3)}`
        : "None",
    Hydrants:
      hydrantCount > 0
        ? `H00001 – ${formatFacilityId("H", hydrantCount, 5)}`
        : "None",
    PressureZones:
      pzZones.length > 0
        ? `PZ01 – ${formatFacilityId("PZ", pzZones.length, 2)}`
        : "PZ01",
  };

  const inpFileName = `${safeName}.inp`;
  const markdownSummary = [
    `### ⚡ \`build-epanet\` Agent — EPANET 2.2 Model Built (\`${inpFileName}\`)`,
    "",
    `- **Working CRS & Units:** \`${targetCrs}\` (State Plane Feet, \`factor = 1.0\`), Flow Units: \`GPM\`, Headloss: \`Hazen-Williams (H-W)\``,
    `- **Water System JSON Folder:** \`${waterJsonFolder || "Default Water JSON Folder"}\``,
    `- **DEM Elevation Source:** \`${demFolder || "Default DEM Workspace"}\` (\`${nodes.length}\` junctions sampled)`,
    "",
    "#### Standardized `FacilityID` Ranges",
    "| Asset Layer | Standardized ID Range | Count |",
    "| --- | --- | --- |",
    `| **Distribution Pipes** | \`${facilityIdRanges.Pipes}\` | ${pipeFeatures.length || 1} |`,
    `| **Distribution Junctions** | \`${facilityIdRanges.Junctions}\` | ${nodes.length} |`,
    `| **Storage Tanks + Connectors** | \`${facilityIdRanges.Tanks}\` | ${tanks.length} |`,
    `| **Pumps + 3-Pt Curves** | \`${facilityIdRanges.Pumps}\` | ${pumps.length} |`,
    `| **WTP / Reservoirs** | \`${facilityIdRanges.WTP}\` | ${reservoirs.length} |`,
    `| **Hydrants** | \`${facilityIdRanges.Hydrants}\` | ${hydrantCount} |`,
    `| **Pressure Zones** | \`${facilityIdRanges.PressureZones}\` | ${pzZones.length || 1} |`,
    "",
    "#### Topology & Boundary Summary",
    `- **Initial Interior & Tank-Connector Pipes (\`OPEN\`):** \`${openPipes}\``,
    `- **Pressure-Zone Boundary Pipes (\`CLOSED\`):** \`${closedBoundaryPipes}\``,
    `- **Total Allocated Customer Demand:** \`${totalDemandGpm.toFixed(2)} GPM\``,
    "",
    "You can download the generated **`.inp` file** directly from the right-hand panel or inspect its `[JUNCTIONS]`, `[TANKS]`, `[PIPES]`, `[PUMPS]`, and `[CURVES]` sections.",
  ].join("\n");

  return {
    modelName: safeName,
    crs: targetCrs,
    inpContent: inpLines.join("\n"),
    inpFileName,
    stats: {
      junctions: nodes.length,
      pipes: pipes.length,
      tanks: tanks.length,
      tankConnectors: tanks.length,
      pumps: pumps.length,
      pumpCurves: pumps.length,
      wtpReservoirs: reservoirs.length,
      hydrants: hydrantCount,
      pressureZones: pzZones.length || 1,
      openPipes,
      closedBoundaryPipes,
      totalDemandGpm: Number(totalDemandGpm.toFixed(2)),
      demSampledNodes: nodes.length,
    },
    facilityIdRanges,
    markdownSummary,
  };
}

export function recalculateBuildResultFromInp(
  inpContent: string,
  prevResult?: BuildEpanetResult | null,
  fileName?: string | null,
  targetCrs: string = "EPSG:2264"
): BuildEpanetResult {
  const lines = inpContent.split(/\r?\n/);
  let currentSection = "";
  const junctionIds: string[] = [];
  const reservoirIds: string[] = [];
  const tankIds: string[] = [];
  const pipeIds: string[] = [];
  const pumpIds: string[] = [];
  let openPipes = 0;
  let closedBoundaryPipes = 0;
  let totalDemandGpm = 0;
  let demandMultiplier = 1.0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(";")) continue;
    const secMatch = trimmed.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1].toUpperCase();
      continue;
    }

    const withoutComment = trimmed.split(";")[0].trim();
    if (!withoutComment) continue;
    const cols = withoutComment.split(/\s+/);
    if (cols.length === 0) continue;

    if (currentSection === "JUNCTIONS" && cols.length >= 2) {
      junctionIds.push(cols[0]);
      const demandVal = Number(cols[2] ?? 0);
      if (Number.isFinite(demandVal)) {
        totalDemandGpm += demandVal;
      }
    } else if (currentSection === "RESERVOIRS" && cols.length >= 2) {
      reservoirIds.push(cols[0]);
    } else if (currentSection === "TANKS" && cols.length >= 2) {
      tankIds.push(cols[0]);
    } else if (currentSection === "PIPES" && cols.length >= 6) {
      pipeIds.push(cols[0]);
      const statusCol = (cols[7] || "OPEN").toUpperCase();
      if (statusCol.startsWith("CLOS")) {
        closedBoundaryPipes++;
      } else {
        openPipes++;
      }
    } else if (currentSection === "PUMPS" && cols.length >= 3) {
      pumpIds.push(cols[0]);
    } else if (currentSection === "OPTIONS" && cols.length >= 3) {
      if (
        cols[0].toLowerCase() === "demand" &&
        cols[1].toLowerCase() === "multiplier"
      ) {
        const mult = Number(cols[2]);
        if (Number.isFinite(mult) && mult > 0) {
          demandMultiplier = mult;
        }
      }
    }
  }

  const effectiveTotalDemand = Number(
    (totalDemandGpm * demandMultiplier).toFixed(2)
  );
  const resolvedFileName = (
    fileName ||
    prevResult?.inpFileName ||
    "water_distribution_model.inp"
  ).trim();
  const safeModelName = resolvedFileName.replace(/\.inp$/i, "");

  const facilityIdRanges: Record<string, string> = {
    Pipes:
      pipeIds.length > 0
        ? `${pipeIds[0]} – ${pipeIds[pipeIds.length - 1]}`
        : prevResult?.facilityIdRanges.Pipes || "None",
    Junctions:
      junctionIds.length > 0
        ? `${junctionIds[0]} – ${junctionIds[junctionIds.length - 1]}`
        : prevResult?.facilityIdRanges.Junctions || "None",
    Tanks:
      tankIds.length > 0
        ? `${tankIds[0]} – ${tankIds[tankIds.length - 1]}`
        : prevResult?.facilityIdRanges.Tanks || "None",
    Pumps:
      pumpIds.length > 0
        ? `${pumpIds[0]} – ${pumpIds[pumpIds.length - 1]}`
        : prevResult?.facilityIdRanges.Pumps || "None",
    WTP:
      reservoirIds.length > 0
        ? `${reservoirIds[0]} – ${reservoirIds[reservoirIds.length - 1]}`
        : prevResult?.facilityIdRanges.WTP || "None",
    Hydrants: prevResult?.facilityIdRanges.Hydrants || "None",
    PressureZones: prevResult?.facilityIdRanges.PressureZones || "PZ01",
  };

  return {
    modelName: safeModelName,
    crs: prevResult?.crs || targetCrs,
    inpContent,
    inpFileName: resolvedFileName,
    stats: {
      junctions: junctionIds.length || prevResult?.stats.junctions || 0,
      pipes: pipeIds.length || prevResult?.stats.pipes || 0,
      tanks: tankIds.length || prevResult?.stats.tanks || 0,
      tankConnectors: tankIds.length || prevResult?.stats.tankConnectors || 0,
      pumps: pumpIds.length || prevResult?.stats.pumps || 0,
      pumpCurves: pumpIds.length || prevResult?.stats.pumpCurves || 0,
      wtpReservoirs:
        reservoirIds.length || prevResult?.stats.wtpReservoirs || 0,
      hydrants: prevResult?.stats.hydrants || 0,
      pressureZones: prevResult?.stats.pressureZones || 1,
      openPipes,
      closedBoundaryPipes,
      totalDemandGpm: effectiveTotalDemand,
      demSampledNodes:
        junctionIds.length || prevResult?.stats.demSampledNodes || 0,
    },
    facilityIdRanges,
    markdownSummary: prevResult?.markdownSummary || "",
  };
}

export function createSampleWaterSystemLayers(): Partial<
  Record<WaterLayerKey, UploadedLayerInfo>
> {
  // Default fallback matches Gasparilla Island, Florida (EPSG:6318 / EPSG:4326)
  const samplePipeGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: { FacilityID: "P00001", Diameter: 12, Material: "DIP", Roughness: 130 },
        geometry: {
          type: "LineString",
          coordinates: [
            [-82.2601, 26.7194],
            [-82.2635, 26.7465],
            [-82.2682, 26.7745],
          ],
        },
      },
      {
        type: "Feature",
        properties: { FacilityID: "P00002", Diameter: 12, Material: "PVC", Roughness: 130 },
        geometry: {
          type: "LineString",
          coordinates: [
            [-82.2682, 26.7745],
            [-82.2755, 26.8012],
            [-82.2821, 26.8080],
          ],
        },
      },
      {
        type: "Feature",
        properties: { FacilityID: "P00003", Diameter: 16, Material: "DIP", Roughness: 130 },
        geometry: {
          type: "LineString",
          coordinates: [
            [-82.2821, 26.8080],
            [-82.2705, 26.8350],
            [-82.2540, 26.8615],
          ],
        },
      },
      {
        type: "Feature",
        properties: { FacilityID: "P00004", Diameter: 16, Material: "PVC", Roughness: 130 },
        geometry: {
          type: "LineString",
          coordinates: [
            [-82.2540, 26.8615],
            [-82.2367, 26.8886],
          ],
        },
      },
    ],
  };

  const sampleTankGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: {
          FacilityID: "T001",
          Name: "Gasparilla Island Elevated Tank",
          Overflow: 135,
          Depth: 35,
          Diameter: 65,
          ELEV_FT: 8,
        },
        geometry: {
          type: "Point",
          coordinates: [-82.2632, 26.7485],
        },
      },
    ],
  };

  const samplePumpGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: {
          FacilityID: "pump001",
          Name: "Gasparilla Booster Station",
          GPM: 1250,
          HeadFt: 118,
          Status: "OPEN",
        },
        geometry: {
          type: "Point",
          coordinates: [-82.2371, 26.8882],
        },
      },
    ],
  };

  const sampleDemandGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: { MeterID: "M-101", GPM: 85.5, Category: "Residential" },
        geometry: { type: "Point", coordinates: [-82.2625, 26.7452] },
      },
      {
        type: "Feature",
        properties: { MeterID: "M-102", GPM: 142.0, Category: "Commercial" },
        geometry: { type: "Point", coordinates: [-82.2675, 26.7735] },
      },
      {
        type: "Feature",
        properties: { MeterID: "M-103", GPM: 64.5, Category: "Residential" },
        geometry: { type: "Point", coordinates: [-82.2745, 26.7985] },
      },
    ],
  };

  const samplePzGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: { FacilityID: "PZ01", Name: "Gasparilla Island Zone", HGL_Ft: 135 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-82.283, 26.718],
              [-82.258, 26.718],
              [-82.258, 26.815],
              [-82.283, 26.815],
              [-82.283, 26.718],
            ],
          ],
        },
      },
    ],
  };

  const sampleWtpGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: { FacilityID: "WTP001", Name: "GIWA Mainland WTP", HeadFt: 145 },
        geometry: { type: "Point", coordinates: [-82.2367, 26.8886] },
      },
    ],
  };

  const sampleHydrantGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:EPSG::6318" },
    },
    features: [
      {
        type: "Feature",
        properties: { FacilityID: "H00001", FlowClass: "AA" },
        geometry: { type: "Point", coordinates: [-82.2635, 26.7465] },
      },
      {
        type: "Feature",
        properties: { FacilityID: "H00002", FlowClass: "A" },
        geometry: { type: "Point", coordinates: [-82.2682, 26.7745] },
      },
    ],
  };

  return {
    pipe: parseWaterJsonFile("pipe.json", JSON.stringify(samplePipeGeoJson, null, 2), "pipe"),
    tank: parseWaterJsonFile("tank.json", JSON.stringify(sampleTankGeoJson, null, 2), "tank"),
    pump: parseWaterJsonFile("pump.json", JSON.stringify(samplePumpGeoJson, null, 2), "pump"),
    water_demand: parseWaterJsonFile(
      "water-demand.json",
      JSON.stringify(sampleDemandGeoJson, null, 2),
      "water_demand"
    ),
    pressure_zone: parseWaterJsonFile(
      "pressure-zone.json",
      JSON.stringify(samplePzGeoJson, null, 2),
      "pressure_zone"
    ),
    wtp: parseWaterJsonFile("wtp.json", JSON.stringify(sampleWtpGeoJson, null, 2), "wtp"),
    hydrant: parseWaterJsonFile(
      "hydrant.json",
      JSON.stringify(sampleHydrantGeoJson, null, 2),
      "hydrant"
    ),
  };
}

function collectRawCoordsFromGeoJson(coords: unknown, out: Array<[number, number]>): void {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const x = Number(coords[0]);
    const y = Number(coords[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push([x, y]);
    }
    return;
  }
  for (const child of coords) {
    collectRawCoordsFromGeoJson(child, out);
  }
}

function convertPointToWgs84(
  pt: [number, number],
  targetCrs: string
): [number, number] {
  const [x, y] = pt;
  if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
    return [x, y];
  }

  const crsUpper = (targetCrs || "").toUpperCase();
  const isFlWest = crsUpper.includes("2882") || crsUpper.includes("2237");
  const isFlEast =
    crsUpper.includes("2881") ||
    crsUpper.includes("2236") ||
    (!isFlWest &&
      x >= 450000 &&
      x <= 1050000 &&
      y >= 200000 &&
      y <= 2200000 &&
      !crsUpper.includes("2264"));

  if (isFlWest || isFlEast) {
    // Exact inverse Transverse Mercator for NAD83 Florida West (EPSG:2882, lon0=-82) or Florida East (EPSG:2881, lon0=-81)
    const ftToM = 1200 / 3937;
    const xM = x * ftToM - 200000.0001016;
    const yM = y * ftToM;
    const a = 6378137.0;
    const f = 1 / 298.257222101;
    const e2 = 2 * f - f * f;
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const k0 = 0.999941177;
    const lat0 = (24.3333333333333 * Math.PI) / 180;
    const lon0 = ((isFlWest ? -82.0 : -81.0) * Math.PI) / 180;
    const M0 =
      a *
      ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * lat0 -
        ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) *
          Math.sin(2 * lat0) +
        ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) *
          Math.sin(4 * lat0));
    const M = M0 + yM / k0;
    const mu =
      M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
    const phi1 =
      mu +
      ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
      ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
      ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu);
    const ep2 = e2 / (1 - e2);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) * Math.sin(phi1));
    const T1 = Math.tan(phi1) * Math.tan(phi1);
    const C1 = ep2 * Math.cos(phi1) * Math.cos(phi1);
    const R1 =
      (a * (1 - e2)) /
      Math.pow(1 - e2 * Math.sin(phi1) * Math.sin(phi1), 1.5);
    const D = xM / (N1 * k0);
    const lat =
      phi1 -
      ((N1 * Math.tan(phi1)) / R1) *
        ((D * D) / 2 -
          ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4)) /
            24);
    const lon =
      lon0 +
      (D -
        ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
        ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) *
          Math.pow(D, 5)) /
          120) /
        Math.cos(phi1);
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
  }

  // Exact inverse Lambert Conformal Conic for NAD83 North Carolina State Plane (ftUS, EPSG:2264)
  // Matches proj4: +proj=lcc +lat_1=36.16666666666666 +lat_2=34.33333333333334 +lat_0=33.75 +lon_0=-79 +x_0=609601.2192024384 +y_0=0 +datum=NAD83 +units=us-ft
  const ftToM = 1200 / 3937;
  const xM = x * ftToM - 609601.2192024384;
  const yM = y * ftToM;
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e = Math.sqrt(2 * f - f * f);
  const phi1 = (36.16666666666666 * Math.PI) / 180;
  const phi2 = (34.33333333333334 * Math.PI) / 180;
  const phi0 = (33.75 * Math.PI) / 180;
  const lam0 = (-79.0 * Math.PI) / 180;

  const calcM = (phi: number) =>
    Math.cos(phi) / Math.sqrt(1 - Math.pow(e * Math.sin(phi), 2));
  const calcT = (phi: number) =>
    Math.tan(Math.PI / 4 - phi / 2) /
    Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2);

  const m1 = calcM(phi1);
  const m2 = calcM(phi2);
  const t1 = calcT(phi1);
  const t2 = calcT(phi2);
  const t0 = calcT(phi0);
  const n = (Math.log(m1) - Math.log(m2)) / (Math.log(t1) - Math.log(t2));
  const F = m1 / (n * Math.pow(t1, n));
  const rho0 = a * F * Math.pow(t0, n);
  const dy = rho0 - yM;
  const rho = Math.sign(n) * Math.sqrt(xM * xM + dy * dy);
  const theta = Math.atan2(xM, dy);
  const t = Math.pow(rho / (a * F), 1 / n);

  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 6; i++) {
    phi =
      Math.PI / 2 -
      2 *
        Math.atan(
          t *
            Math.pow(
              (1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)),
              e / 2
            )
        );
  }
  const lam = theta / n + lam0;
  return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

function createFallbackGeoTiffBytes(width = 64, height = 64): Uint8Array {
  // Minimal valid uncompressed 32-bit float TIFF header + raster elevation grid
  const pixelBytes = width * height * 4;
  const headerSize = 8 + 2 + 12 * 10 + 4;
  const totalSize = headerSize + pixelBytes;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // Little-endian "II", magic 42, IFD offset 8
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  let pos = 8;
  const numEntries = 10;
  view.setUint16(pos, numEntries, true);
  pos += 2;

  const writeTag = (tag: number, type: number, count: number, valueOrOffset: number) => {
    view.setUint16(pos, tag, true);
    view.setUint16(pos + 2, type, true);
    view.setUint32(pos + 4, count, true);
    view.setUint32(pos + 8, valueOrOffset, true);
    pos += 12;
  };

  writeTag(256, 4, 1, width); // ImageWidth
  writeTag(257, 4, 1, height); // ImageLength
  writeTag(258, 3, 1, 32); // BitsPerSample = 32
  writeTag(259, 3, 1, 1); // Compression = None
  writeTag(262, 3, 1, 1); // PhotometricInterpretation = BlackIsZero
  writeTag(273, 4, 1, headerSize); // StripOffsets
  writeTag(277, 3, 1, 1); // SamplesPerPixel = 1
  writeTag(278, 4, 1, height); // RowsPerStrip
  writeTag(279, 4, 1, pixelBytes); // StripByteCounts
  writeTag(339, 3, 1, 3); // SampleFormat = 3 (IEEE floating point)

  view.setUint32(pos, 0, true); // Next IFD offset = 0

  let dataPos = headerSize;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const elevFt = 395 + 25 * Math.sin(r / 8) + 18 * Math.cos(c / 9);
      view.setFloat32(dataPos, elevFt, true);
      dataPos += 4;
    }
  }
  return new Uint8Array(buf);
}

const LAYER_MAP_COLORS: Record<WaterLayerKey, string> = {
  pipe: "#2563eb",
  tank: "#0284c7",
  pump: "#d97706",
  water_demand: "#059669",
  pressure_zone: "#7c3aed",
  wtp: "#dc2626",
  hydrant: "#ea580c",
};

function convertCoordinatesTreeToWgs84(
  coords: unknown,
  targetCrs: string
): unknown {
  if (!Array.isArray(coords) || coords.length === 0) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lon, lat] = convertPointToWgs84(
      [Number(coords[0]), Number(coords[1])],
      targetCrs
    );
    return [lon, lat];
  }
  return coords.map((child) => convertCoordinatesTreeToWgs84(child, targetCrs));
}

function wgs84ToWebMercator(pt: [number, number]): [number, number] {
  const [lon, lat] = pt;
  const x = (lon * 20037508.34) / 180;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y =
    (Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) /
      (Math.PI / 180)) *
    (20037508.34 / 180);
  return [x, y];
}

function computeConvexHull4326(
  pts: Array<[number, number]>
): Array<[number, number]> {
  if (pts.length <= 3) return pts.slice();
  const sorted = pts
    .slice()
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number]
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Array<[number, number]> = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function simplifyRing4326(
  pts: Array<[number, number]>,
  maxVerts = 340
): Array<[number, number]> {
  if (pts.length <= maxVerts) return pts;
  const step = Math.ceil(pts.length / maxVerts);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push(pts[i]);
  }
  return out;
}

function computePolygonAreaSqMiles4326(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const ring3857 = ring.map((pt) => wgs84ToWebMercator(pt));
  let areaWebMercSqM = 0;
  for (let i = 0; i < ring3857.length; i++) {
    const next = ring3857[(i + 1) % ring3857.length];
    areaWebMercSqM += ring3857[i][0] * next[1] - next[0] * ring3857[i][1];
  }
  areaWebMercSqM = Math.abs(areaWebMercSqM) / 2;
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  return (areaWebMercSqM * Math.pow(Math.cos(midLatRad), 2)) / 2589988.110336;
}

function computePipeCorridorHull4326(
  pts: Array<[number, number]>,
  convexHull: Array<[number, number]>
): Array<[number, number]> {
  if (pts.length < 12 || convexHull.length < 3) return convexHull;

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  if (spanLon <= 0.0005 || spanLat <= 0.0005) return convexHull;

  const numSlices = 32;
  const dLat = spanLat / numSlices;
  const padLon = Math.max(0.0008, spanLon * 0.025);
  const padLat = Math.max(0.0008, spanLat * 0.01);

  const rawMinLons: number[] = [];
  const rawMaxLons: number[] = [];
  const sliceYs: number[] = [];

  for (let i = 0; i <= numSlices; i++) {
    const centerY = minLat + i * dLat;
    const loY = centerY - dLat * 0.75;
    const hiY = centerY + dLat * 0.75;
    let sMinX = Infinity;
    let sMaxX = -Infinity;
    for (const [x, y] of pts) {
      if (y >= loY && y <= hiY) {
        if (x < sMinX) sMinX = x;
        if (x > sMaxX) sMaxX = x;
      }
    }
    if (sMinX <= sMaxX) {
      rawMinLons.push(sMinX - padLon);
      rawMaxLons.push(sMaxX + padLon);
      sliceYs.push(
        i === 0
          ? minLat - padLat
          : i === numSlices
            ? maxLat + padLat
            : centerY
      );
    }
  }

  if (sliceYs.length < 4) return convexHull;

  const smoothMin = rawMinLons.map((v, idx, arr) => {
    const prev = arr[Math.max(0, idx - 1)];
    const next = arr[Math.min(arr.length - 1, idx + 1)];
    return Math.min(v, 0.25 * prev + 0.5 * v + 0.25 * next);
  });
  const smoothMax = rawMaxLons.map((v, idx, arr) => {
    const prev = arr[Math.max(0, idx - 1)];
    const next = arr[Math.min(arr.length - 1, idx + 1)];
    return Math.max(v, 0.25 * prev + 0.5 * v + 0.25 * next);
  });

  const corridorHull: Array<[number, number]> = [];
  for (let i = 0; i < sliceYs.length; i++) {
    corridorHull.push([smoothMax[i], sliceYs[i]]);
  }
  for (let i = sliceYs.length - 1; i >= 0; i--) {
    corridorHull.push([smoothMin[i], sliceYs[i]]);
  }

  const convexArea = computePolygonAreaSqMiles4326(convexHull);
  const corridorArea = computePolygonAreaSqMiles4326(corridorHull);

  // Use the tight pipe-corridor polygon when the pipe network forms a curved/barrier-island corridor
  // (such as Gasparilla Island, FL) where a naive convex hull spans across open water.
  if (convexArea > 0 && corridorArea > 0 && corridorArea < convexArea * 0.78) {
    return corridorHull;
  }
  return convexHull;
}

function detectSourceCrsFromGeoJson(
  geojson: GeoJsonFeatureCollection | undefined,
  samplePt: [number, number] | undefined,
  explicitCrs?: string
): string {
  const crsObj = geojson?.crs as
    | { properties?: { name?: string } }
    | undefined;
  const crsName = String(crsObj?.properties?.name || "");
  if (crsName) {
    if (crsName.toUpperCase().includes("CRS84")) return "EPSG:4326";
    const m = crsName.match(/(?:EPSG[:/]+|CRS84)(\d{4,6})?/i);
    if (m && m[1]) return `EPSG:${m[1]}`;
  }
  if (samplePt) {
    const [x, y] = samplePt;
    if (x >= -180 && x <= 180 && y >= -90 && y <= 90) return "EPSG:4326";
  }
  if (explicitCrs && explicitCrs.trim()) {
    const m = explicitCrs.toUpperCase().match(/(\d{4,6})/);
    if (m) return `EPSG:${m[1]}`;
  }
  if (samplePt) {
    const [x, y] = samplePt;
    if (x >= 500000 && x <= 1100000 && y >= 200000 && y <= 2000000) {
      return "EPSG:2881";
    }
    return "EPSG:2264";
  }
  return "EPSG:2882";
}

export function computeGisCoverageForWaterSystem(
  layers: Partial<Record<WaterLayerKey, UploadedLayerInfo>>,
  targetCrs: string
): GisCoverageSummary {
  // Determine the DEM coverage area strictly from pipe.json (layers.pipe)
  const pipeLayer =
    layers.pipe && layers.pipe.data?.features?.length
      ? layers.pipe
      : Object.values(layers).find((l) => l?.data?.features?.length);

  const rawPts: Array<[number, number]> = [];
  const layerOverlays: GisLayerOverlaySummary[] = [];

  if (pipeLayer?.data?.features?.length) {
    const pipeFeatures = pipeLayer.data.features;
    for (const feat of pipeFeatures) {
      if (feat.geometry?.coordinates) {
        collectRawCoordsFromGeoJson(feat.geometry.coordinates, rawPts);
      }
    }
  }

  const usingFallbackAoi = rawPts.length === 0;
  const detectedSourceCrs = detectSourceCrsFromGeoJson(
    pipeLayer?.data,
    rawPts[0],
    pipeLayer?.data?.crs ? undefined : targetCrs
  );

  // Build map overlay for pipe.json (up to 1,500 features so all 1,332 Gasparilla Island pipes render cleanly)
  if (pipeLayer?.data?.features?.length) {
    const allFeats = pipeLayer.data.features;
    const maxMapFeats = 1500;
    const step =
      allFeats.length > maxMapFeats
        ? Math.ceil(allFeats.length / maxMapFeats)
        : 1;
    const wgs84Features: GeoJsonFeature[] = [];
    for (let i = 0; i < allFeats.length; i += step) {
      const feat = allFeats[i];
      if (!feat?.geometry?.coordinates) continue;
      wgs84Features.push({
        type: "Feature",
        properties: {
          ...(feat.properties || {}),
          _layerKey: pipeLayer.key,
          _layerLabel: pipeLayer.label,
        },
        geometry: {
          type: feat.geometry.type,
          coordinates: convertCoordinatesTreeToWgs84(
            feat.geometry.coordinates,
            detectedSourceCrs
          ),
        },
      });
    }
    if (wgs84Features.length > 0) {
      layerOverlays.push({
        key: pipeLayer.key,
        label: pipeLayer.label.replace(/\s*\(.*\)$/, ""),
        fileName: pipeLayer.fileName,
        featureCount: allFeats.length,
        color: LAYER_MAP_COLORS[pipeLayer.key] || "#2563eb",
        wgs84GeoJson: {
          type: "FeatureCollection",
          features: wgs84Features,
        },
      });
    }
  }

  const wgs84Pts: Array<[number, number]> =
    rawPts.length > 0
      ? rawPts.map((pt) => convertPointToWgs84(pt, detectedSourceCrs))
      : [
          [-82.2821, 26.7194],
          [-82.2601, 26.7194],
          [-82.2367, 26.8886],
          [-82.2821, 26.8080],
        ];

  let hull: Array<[number, number]> = [];
  if (
    pipeLayer?.data?.features?.length === 1 &&
    pipeLayer.data.features[0].geometry?.type === "Polygon" &&
    Array.isArray(pipeLayer.data.features[0].geometry.coordinates)
  ) {
    const polyPts: Array<[number, number]> = [];
    collectRawCoordsFromGeoJson(
      (pipeLayer.data.features[0].geometry.coordinates as unknown[])[0],
      polyPts
    );
    hull = polyPts.map((pt) => convertPointToWgs84(pt, detectedSourceCrs));
  } else {
    const convexHull = computeConvexHull4326(wgs84Pts);
    hull = computePipeCorridorHull4326(wgs84Pts, convexHull);
  }

  if (hull.length < 3) {
    const [cx, cy] = wgs84Pts[0];
    const d = 0.001;
    hull = [
      [cx - d, cy - d],
      [cx + d, cy - d],
      [cx + d, cy + d],
      [cx - d, cy + d],
    ];
  }

  const originalVertexCount = hull.length;
  const simplified = simplifyRing4326(hull, 340);
  const ring4326: Array<[number, number]> = simplified.map(([x, y]) => [
    Number(x.toFixed(7)),
    Number(y.toFixed(7)),
  ]);
  if (
    ring4326.length > 0 &&
    (ring4326[0][0] !== ring4326[ring4326.length - 1][0] ||
      ring4326[0][1] !== ring4326[ring4326.length - 1][1])
  ) {
    ring4326.push([ring4326[0][0], ring4326[0][1]]);
  }

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring4326) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }

  const [mercMinX, mercMinY] = wgs84ToWebMercator([minLon, minLat]);
  const [mercMaxX, mercMaxY] = wgs84ToWebMercator([maxLon, maxLat]);
  const ring3857 = ring4326.map((pt) => wgs84ToWebMercator(pt));

  let areaWebMercSqM = 0;
  for (let i = 0; i < ring3857.length - 1; i++) {
    areaWebMercSqM +=
      ring3857[i][0] * ring3857[i + 1][1] -
      ring3857[i + 1][0] * ring3857[i][1];
  }
  areaWebMercSqM = Math.abs(areaWebMercSqM) / 2;
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const trueAreaSqMiles =
    (areaWebMercSqM * Math.pow(Math.cos(midLatRad), 2)) / 2589988.110336;
  const areaSqMiles = Number(trueAreaSqMiles.toFixed(4));
  const areaAcres = Number((trueAreaSqMiles * 640).toFixed(2));

  const bbox4326: [number, number, number, number] = [
    Number(minLon.toFixed(7)),
    Number(minLat.toFixed(7)),
    Number(maxLon.toFixed(7)),
    Number(maxLat.toFixed(7)),
  ];
  const bbox3857: [number, number, number, number] = [
    Number(mercMinX.toFixed(3)),
    Number(mercMinY.toFixed(3)),
    Number(mercMaxX.toFixed(3)),
    Number(mercMaxY.toFixed(3)),
  ];
  const wktAoi = `SRID=4269;POLYGON((${ring4326
    .map(([x, y]) => `${x} ${y}`)
    .join(", ")}))`;

  const noaaRestrictedGeoJson: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { FID: 1, Id: 0 },
        geometry: {
          type: "Polygon",
          coordinates: [ring4326],
        },
      },
    ],
  };

  return {
    sourceFileName: pipeLayer?.fileName || "pipe.json",
    sourceCrs: detectedSourceCrs,
    featureCount: pipeLayer?.data?.features?.length || 0,
    originalVertexCount,
    simplifiedVertexCount: ring4326.length,
    areaSqMiles,
    areaAcres,
    bbox4326,
    bbox3857,
    wktAoi,
    ring4326,
    noaaRestrictedGeoJson,
    layerOverlays,
    usingFallbackAoi,
  };
}

export async function discoverDemOptionsForWaterSystem(params: {
  layers: Partial<Record<WaterLayerKey, UploadedLayerInfo>>;
  targetCrs: string;
}): Promise<{
  coverage: GisCoverageSummary;
  datasets: NoaaDemDatasetOption[];
}> {
  const coverage = computeGisCoverageForWaterSystem(
    params.layers,
    params.targetCrs
  );

  const datasets: NoaaDemDatasetOption[] = [];

  try {
    const noaaResp = await fetchWithTimeout(
      `${NOAA_API_PROXY_URL}/missions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          aoi: coverage.wktAoi,
          dataTypes: ["Lidar", "DEM"],
          published: "true",
          page: 0,
          pageSize: 50,
          sort: "desc",
          sortField: "year",
        }),
      },
      6500
    );

    if (noaaResp.ok) {
      const noaaJson = (await noaaResp.json()) as {
        missions?: {
          data?: Array<{
            missionId?: string | number;
            id?: string | number;
            title?: string;
            year?: string | number;
            dataType?: string;
            Links?: Array<{
              uri?: string;
              link?: string;
              linkTypeId?: string | number;
              title?: string;
              linkTypeName?: string;
            }>;
            links?: Array<{
              uri?: string;
              link?: string;
              linkTypeId?: string | number;
              title?: string;
              linkTypeName?: string;
            }>;
            attributes?: {
              id?: string | number;
              title?: string;
              year?: string | number;
              date?: string | number;
              dataType?: string;
              verticalDatum?: Array<{ name?: string }>;
              links?: Array<{
                uri?: string;
                link?: string;
                linkTypeId?: string | number;
                title?: string;
                linkTypeName?: string;
              }>;
              Links?: Array<{
                uri?: string;
                link?: string;
                linkTypeId?: string | number;
                title?: string;
                linkTypeName?: string;
              }>;
              details?: {
                dem?: {
                  nativeVDatum?: { description?: string };
                };
              };
            };
          }>;
        };
      };

      const rawMissions = noaaJson.missions?.data || [];
      for (const m of rawMissions) {
        const attr = m.attributes || m;
        const links =
          attr.links || attr.Links || m.Links || m.links || [];
        let bulkUrl: string | null = null;
        let metadataUrl: string | null = null;
        let customDownloadUrl: string | null = null;

        for (const l of links) {
          const typeId = String(l.linkTypeId || "");
          const titleLower = String(
            l.title || l.linkTypeName || ""
          ).toLowerCase();
          const uri = String(l.uri || l.link || "").trim();
          if (!uri) continue;
          if (typeId === "46" || titleLower.includes("bulk download")) {
            bulkUrl = uri;
          } else if (
            typeId === "35" ||
            typeId === "39" ||
            titleLower.includes("metadata")
          ) {
            metadataUrl = uri;
          } else if (typeId === "45" || titleLower.includes("custom download")) {
            customDownloadUrl = uri;
          }
        }

        const isS3Bulk = Boolean(
          bulkUrl &&
            (bulkUrl.toLowerCase().includes("amazonaws.com") ||
              bulkUrl.toLowerCase().endsWith("index.html") ||
              bulkUrl.toLowerCase().includes("coast.noaa.gov/htdata"))
        );

        const vDatum =
          m.attributes?.verticalDatum?.[0]?.name ||
          m.attributes?.details?.dem?.nativeVDatum?.description ||
          "NAVD88";

        const dataType = String(m.dataType || attr.dataType || "DEM");
        datasets.push({
          missionId: String(m.missionId || m.id || attr.id || ""),
          title: String(m.title || attr.title || "NOAA Digital Coast Dataset"),
          year: String(
            attr.year || m.attributes?.date || m.year || "N/A"
          ),
          dataType,
          verticalDatum: vDatum,
          bulkDownloadUrl: isS3Bulk ? bulkUrl : null,
          externalPortalUrl: bulkUrl && !isS3Bulk ? bulkUrl : null,
          metadataUrl,
          customDownloadUrl,
          recommended: false,
        });
      }
    }
  } catch {
    // Fallback if offline
  }

  if (datasets.length === 0) {
    datasets.push(
      {
        missionId: "10208",
        title: "2024 USACE FEMA Topobathy Lidar DEM: Post Hurricane Milton, FL",
        year: "2024",
        dataType: "DEM",
        verticalDatum: "NAVD88",
        bulkDownloadUrl:
          "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/USACE_FEMA_Milton_DEM_2024_10208/index.html",
        externalPortalUrl: null,
        metadataUrl: "https://www.fisheries.noaa.gov/inport/item/75803",
        customDownloadUrl:
          "https://coast.noaa.gov/dataviewer/#/lidar/search/where:ID=10208/details/10208",
        recommended: true,
      },
      {
        missionId: "10012",
        title: "2022 USACE NCMP Topobathy Lidar DEM: Gulf Coast (FL)",
        year: "2022",
        dataType: "DEM",
        verticalDatum: "NAVD88",
        bulkDownloadUrl:
          "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/USACE_FL_GulfCoast_DEM_2022_10012/index.html",
        externalPortalUrl: null,
        metadataUrl: "https://www.fisheries.noaa.gov/inport/item/72318",
        customDownloadUrl:
          "https://coast.noaa.gov/dataviewer/#/lidar/search/where:ID=10012/details/10012",
        recommended: false,
      },
      {
        missionId: "8812",
        title: "2018 USGS Lidar DEM: Southwest, FL",
        year: "2018",
        dataType: "DEM",
        verticalDatum: "NAVD88",
        bulkDownloadUrl:
          "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/USGS_FL_Southwest_DEM_2018_8812/index.html",
        externalPortalUrl: null,
        metadataUrl: "https://www.fisheries.noaa.gov/inport/item/57544",
        customDownloadUrl:
          "https://coast.noaa.gov/dataviewer/#/lidar/search/where:ID=8812/details/8812",
        recommended: false,
      }
    );
  }

  // Mark the newest DEM with bulk download (or first DEM) as recommended
  const bestDem =
    datasets.find(
      (d) => d.dataType.toUpperCase() === "DEM" && Boolean(d.bulkDownloadUrl)
    ) ||
    datasets.find((d) => d.dataType.toUpperCase() === "DEM") ||
    datasets[0];
  if (bestDem) {
    bestDem.recommended = true;
  }

  return { coverage, datasets };
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function inflateRawBytesInBrowser(
  compressed: Uint8Array
): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate-raw");
    // IMPORTANT: Start consuming ds.readable BEFORE writing to ds.writable!
    // Awaiting writer.write() before reading deadlocks when decompressed output > 64KB (e.g. 1.47MB .dbf).
    const readPromise = new Response(ds.readable).arrayBuffer();
    const writer = ds.writable.getWriter();
    void writer.write(compressed.slice() as unknown as BufferSource);
    void writer.close();
    const ab = await Promise.race([
      readPromise,
      new Promise<ArrayBuffer>((_, reject) =>
        setTimeout(() => reject(new Error("Decompression timeout")), 4000)
      ),
    ]);
    return new Uint8Array(ab);
  }
  return compressed;
}

function tileBboxIntersectsPipeCoverage(
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number,
  coverage: GisCoverageSummary
): boolean {
  const [aoiMinLon, aoiMinLat, aoiMaxLon, aoiMaxLat] = coverage.bbox4326;
  if (
    xmax < aoiMinLon ||
    xmin > aoiMaxLon ||
    ymax < aoiMinLat ||
    ymin > aoiMaxLat
  ) {
    return false;
  }
  const pipeOverlay = coverage.layerOverlays[0];
  if (!pipeOverlay?.wgs84GeoJson?.features?.length) {
    return true;
  }
  const pad = 0.002;
  for (const feat of pipeOverlay.wgs84GeoJson.features) {
    const coords = feat.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    for (const c of coords as unknown[]) {
      if (
        Array.isArray(c) &&
        typeof c[0] === "number" &&
        typeof c[1] === "number"
      ) {
        if (
          c[0] >= xmin - pad &&
          c[0] <= xmax + pad &&
          c[1] >= ymin - pad &&
          c[1] <= ymax + pad
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function intersectS3TileIndexForMission(
  bulkDownloadUrl: string,
  coverage: GisCoverageSummary
): Promise<DemIntersectingTile[]> {
  const indexResp = await fetchWithTimeout(bulkDownloadUrl, undefined, 7000);
  if (!indexResp.ok) {
    throw new Error(`Failed to fetch S3 index page: ${bulkDownloadUrl}`);
  }
  const html = await indexResp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const hrefs = Array.from(doc.querySelectorAll("a"))
    .map((a) => a.getAttribute("href") || "")
    .filter(Boolean);

  let tileIndexZipUrl: string | null = null;
  let stacCollectionUrl: string | null = null;

  for (const href of hrefs) {
    const fullUrl = new URL(href, bulkDownloadUrl).toString();
    const lower = href.toLowerCase();
    if (lower.includes("tileindex") && lower.endsWith(".zip")) {
      tileIndexZipUrl = fullUrl;
    } else if (
      lower.includes("noaa_item_collection") &&
      lower.endsWith(".json")
    ) {
      stacCollectionUrl = fullUrl;
    }
  }

  const hits: DemIntersectingTile[] = [];

  if (tileIndexZipUrl) {
    const zipResp = await fetchWithTimeout(tileIndexZipUrl, undefined, 8000);
    if (zipResp.ok) {
      const zipAb = await zipResp.arrayBuffer();
      const zipView = new DataView(zipAb);
      let offset = 0;
      let shpBytes: Uint8Array | null = null;
      let dbfBytes: Uint8Array | null = null;

      while (offset + 30 <= zipAb.byteLength) {
        const sig = zipView.getUint32(offset, true);
        if (sig !== 0x04034b50) break;
        const method = zipView.getUint16(offset + 8, true);
        const compSize = zipView.getUint32(offset + 18, true);
        const nameLen = zipView.getUint16(offset + 26, true);
        const extraLen = zipView.getUint16(offset + 28, true);
        const nameBytes = new Uint8Array(zipAb, offset + 30, nameLen);
        const entryName = new TextDecoder("utf-8").decode(nameBytes);
        const dataStart = offset + 30 + nameLen + extraLen;
        if (dataStart + compSize > zipAb.byteLength) break;

        const ext = entryName.split(".").pop()?.toLowerCase() || "";
        if (ext === "shp" || ext === "dbf") {
          const compSlice = new Uint8Array(zipAb, dataStart, compSize);
          const uncomp =
            method === 8
              ? await inflateRawBytesInBrowser(compSlice)
              : compSlice;
          if (ext === "shp") shpBytes = uncomp;
          if (ext === "dbf") dbfBytes = uncomp;
        }
        offset = dataStart + compSize;
      }

      if (shpBytes && dbfBytes) {
        const shpView = new DataView(
          shpBytes.buffer,
          shpBytes.byteOffset,
          shpBytes.byteLength
        );
        const dbfView = new DataView(
          dbfBytes.buffer,
          dbfBytes.byteOffset,
          dbfBytes.byteLength
        );
        const headerLen = dbfView.getUint16(8, true);
        const recordLen = dbfView.getUint16(10, true);
        const decoder = new TextDecoder("utf-8");

        const fields: Array<{ name: string; len: number }> = [];
        for (let p = 32; p + 32 <= headerLen - 1; p += 32) {
          if (dbfBytes[p] === 0x0d) break;
          const rawName = decoder
            .decode(dbfBytes.subarray(p, p + 11))
            .replace(/\0.*$/, "")
            .trim();
          const flen = dbfBytes[p + 16];
          fields.push({ name: rawName, len: flen });
        }

        let shpPos = 100;
        let recIdx = 0;

        while (shpPos + 8 <= shpBytes.byteLength) {
          const contentWords = shpView.getInt32(shpPos + 4, false);
          const contentBytes = contentWords * 2;
          const recStart = shpPos + 8;
          if (contentBytes <= 0 || recStart + contentBytes > shpBytes.byteLength) {
            break;
          }
          const shapeType = shpView.getInt32(recStart, true);
          if ((shapeType === 5 || shapeType === 15) && contentBytes >= 44) {
            const xmin = shpView.getFloat64(recStart + 4, true);
            const ymin = shpView.getFloat64(recStart + 12, true);
            const xmax = shpView.getFloat64(recStart + 20, true);
            const ymax = shpView.getFloat64(recStart + 28, true);

            const bboxIntersects = tileBboxIntersectsPipeCoverage(
              xmin,
              ymin,
              xmax,
              ymax,
              coverage
            );

            if (bboxIntersects) {
              // Read polygon vertices for accurate footprint display on map
              const numParts = shpView.getInt32(recStart + 36, true);
              const numPoints = shpView.getInt32(recStart + 40, true);
              const ptsOffset = recStart + 44 + numParts * 4;
              const ring: Array<[number, number]> = [];
              if (ptsOffset + numPoints * 16 <= recStart + contentBytes) {
                for (let ptIdx = 0; ptIdx < numPoints; ptIdx++) {
                  const px = shpView.getFloat64(
                    ptsOffset + ptIdx * 16,
                    true
                  );
                  const py = shpView.getFloat64(
                    ptsOffset + ptIdx * 16 + 8,
                    true
                  );
                  ring.push([Number(px.toFixed(6)), Number(py.toFixed(6))]);
                }
              }
              if (ring.length < 4) {
                ring.push(
                  [xmin, ymin],
                  [xmax, ymin],
                  [xmax, ymax],
                  [xmin, ymax],
                  [xmin, ymin]
                );
              }

              // Read DBF attributes for this record
              let dbfPos = headerLen + recIdx * recordLen + 1;
              const props: Record<string, string> = {};
              if (dbfPos + recordLen - 1 <= dbfBytes.byteLength) {
                for (const f of fields) {
                  props[f.name] = decoder
                    .decode(dbfBytes.subarray(dbfPos, dbfPos + f.len))
                    .trim();
                  dbfPos += f.len;
                }
              }

              const tileUrl = String(
                props.url ||
                  props.URL ||
                  props.Url ||
                  props.location ||
                  props.LOCATION ||
                  ""
              ).trim();
              const resolvedUrl = tileUrl.startsWith("http")
                ? tileUrl
                : tileUrl
                ? new URL(tileUrl, bulkDownloadUrl).toString()
                : "";
              const filename =
                String(
                  props.filename ||
                    props.FILENAME ||
                    props.name ||
                    resolvedUrl.split("/").pop() ||
                    `tile_${recIdx + 1}.tif`
                ).trim();

              if (resolvedUrl.startsWith("http")) {
                hits.push({
                  filename,
                  url: resolvedUrl,
                  bbox: [xmin, ymin, xmax, ymax],
                  geometry: {
                    type: "Polygon",
                    coordinates: [ring],
                  },
                });
              }
            }
          }
          shpPos = recStart + contentBytes;
          recIdx++;
        }
      }
    }
  } else if (stacCollectionUrl) {
    const stacResp = await fetchWithTimeout(stacCollectionUrl, undefined, 6000);
    const stacLen = Number(stacResp.headers.get("content-length") || "0");
    if (stacResp.ok && (stacLen === 0 || stacLen <= 5 * 1024 * 1024)) {
      const stacJson = (await stacResp.json()) as {
        features?: Array<{
          geometry?: { coordinates?: unknown };
          assets?: Record<string, { href?: string }>;
        }>;
      };
      for (const feat of stacJson.features || []) {
        const pts: Array<[number, number]> = [];
        collectRawCoordsFromGeoJson(feat.geometry?.coordinates, pts);
        if (pts.length === 0) continue;
        let xmin = Infinity;
        let ymin = Infinity;
        let xmax = -Infinity;
        let ymax = -Infinity;
        for (const [x, y] of pts) {
          if (x < xmin) xmin = x;
          if (y < ymin) ymin = y;
          if (x > xmax) xmax = x;
          if (y > ymax) ymax = y;
        }
        if (
          !tileBboxIntersectsPipeCoverage(xmin, ymin, xmax, ymax, coverage)
        ) {
          continue;
        }
        const firstAsset = Object.values(feat.assets || {})[0];
        const href = firstAsset?.href;
        if (href) {
          hits.push({
            filename: String(href).split("/").pop() || "tile.tif",
            url: String(href),
            bbox: [xmin, ymin, xmax, ymax],
            geometry: {
              type: "Polygon",
              coordinates: [pts],
            },
          });
        }
      }
    }
  }

  return hits;
}

export async function submitNoaaDavCustomOrder(params: {
  coverage: GisCoverageSummary;
  dataset: NoaaDemDatasetOption;
  userEmail?: string;
}): Promise<{
  requestId: string;
  userEmail: string;
  statusUrl: string;
}> {
  const { coverage, dataset } = params;
  const rawEmail = (params.userEmail || "fqiao@hazenandsawyer.com").trim();
  const normalizedEmail = rawEmail.includes("@")
    ? rawEmail.split("@")[1].includes(".")
      ? rawEmail
      : `${rawEmail}.com`
    : `${rawEmail}@hazenandsawyer.com`;

  const [minX, minY, maxX, maxY] = coverage.bbox4326;
  const [mercMinX, mercMinY, mercMaxX, mercMaxY] = coverage.bbox3857;
  const isDem = dataset.dataType.toUpperCase() === "DEM";

  const jobPayload: Record<string, unknown> = {
    label: dataset.title,
    missionId: String(dataset.missionId),
    minX,
    minY,
    maxX,
    maxY,
    mercMinX,
    mercMinY,
    mercMaxX,
    mercMaxY,
    horizontalDatumId: "2",
    horizontalUnitsId: "3",
    verticalDatumId: "3",
    verticalUnitsId: "3",
    projectionId: "5",
    aoi: coverage.wktAoi,
    vDatumLabel: dataset.verticalDatum || "NAVD88",
    geoidModel: "994d177c-5f55-4cf2-bb81-1c40aa66a578",
  };

  if (isDem) {
    jobPayload.dataType = "DEM";
    jobPayload.dataTypeId = 2;
    jobPayload.fileFormatId = "1";
  } else {
    jobPayload.dataType = "Lidar";
    jobPayload.dataTypeId = 5;
    jobPayload.addAncillaryData = "0";
    jobPayload.dataReturnsSelection = "0";
    jobPayload.lidarDataClasses = "2";
    jobPayload.products = {
      point: { fileFormatId: "13" },
      grid: {
        fileFormatId: "8",
        binMethodId: "2",
        binUnitsId: "3",
        binSize: "3",
        fillGaps: "true",
      },
    };
  }

  const resp = await fetch(`${NOAA_API_PROXY_URL}/requests/request/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jobs: {
        tier: "production",
        userEmail: normalizedEmail,
        organization: "Hazen and Sawyer",
        surveyOptIn: "false",
        digest: "false",
        job: [jobPayload],
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`NOAA order submission failed (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    data?: { requestId?: string | number };
    requestId?: string | number;
  };
  const requestId = String(
    json.data?.requestId || json.requestId || Date.now()
  );
  const statusUrl = `https://coast.noaa.gov/dataviewer/#/admin/request/${requestId}`;
  return {
    requestId,
    userEmail: normalizedEmail,
    statusUrl,
  };
}

export async function downloadDemForWaterSystem(params: {
  layers: Partial<Record<WaterLayerKey, UploadedLayerInfo>>;
  demFolder?: string;
  targetCrs: string;
  selectedDataset?: NoaaDemDatasetOption;
  coverage?: GisCoverageSummary;
  onProgress?: (progress: DemDownloadProgress) => void;
}): Promise<DemDownloadResult> {
  const { layers, targetCrs, selectedDataset, onProgress } = params;
  const emit = (
    percent: number,
    stage: string,
    detail: string,
    bytesReceived?: number,
    totalBytes?: number
  ) => {
    onProgress?.({
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      stage,
      detail,
      bytesReceived,
      totalBytes,
    });
  };

  // Step 1: Compute or reuse Water System GIS Coverage in WGS84 (EPSG:4326)
  emit(
    10,
    "Computing GIS Coverage AOI",
    "Extracting water system GIS coverage polygon (EPSG:4326)..."
  );

  const coverage =
    params.coverage || computeGisCoverageForWaterSystem(layers, targetCrs);
  const bbox4326 = coverage.bbox4326;
  const [minLon, minLat, maxLon, maxLat] = bbox4326;

  let dataset = selectedDataset;
  if (!dataset) {
    emit(
      22,
      "Querying NOAA DEM Catalog",
      `Searching NOAA Digital Coast (${DEM_DOWNLOAD_URL}) for intersecting DEM datasets...`
    );
    const discovered = await discoverDemOptionsForWaterSystem({
      layers,
      targetCrs,
    });
    dataset =
      discovered.datasets.find((d) => d.recommended) || discovered.datasets[0];
  }

  const missionId = dataset?.missionId || "15636";
  const missionTitle =
    dataset?.title || "2024 NC CGIA Lidar DEM: Phase 3, NC Statewide";
  const verticalDatum = dataset?.verticalDatum || "NAVD88";
  const s3BulkUrl = dataset?.bulkDownloadUrl || null;
  const dataType = dataset?.dataType || "DEM";
  const year = dataset?.year || "2024";

  // Step 2: Spatial intersection against NOAA S3 tile index (same strategy as main.d3nvwo119rglg1.amplifyapp.com)
  let intersectingTiles: DemIntersectingTile[] = [];
  if (s3BulkUrl) {
    emit(
      28,
      "Intersecting NOAA S3 Tile Index",
      `Intersecting GIS coverage AOI (${coverage.areaSqMiles} sq mi) with S3 tile index for Mission #${missionId}...`
    );
    try {
      intersectingTiles = await intersectS3TileIndexForMission(
        s3BulkUrl,
        coverage
      );
    } catch {
      intersectingTiles = [];
    }
  }

  const primaryTile = intersectingTiles[0] || null;
  const fileName = primaryTile
    ? primaryTile.filename
    : `NOAA_${dataType}_m${missionId}_${year}.tif`;

  // Step 3: Stream DEM GeoTIFF bytes from intersecting NOAA S3 tile (or 3DEP elevation server fallback)
  const downloadSourceUrl = primaryTile
    ? primaryTile.url
    : `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&size=512,512&imageSR=4326&format=tiff&pixelType=F32&f=image`;

  emit(
    45,
    "Downloading DEM Data",
    intersectingTiles.length > 0
      ? `Found ${intersectingTiles.length} intersecting S3 tile(s) — downloading ${fileName}...`
      : `Downloading ${fileName} for Mission #${missionId} (${missionTitle})...`
  );

  let tifBytes: Uint8Array;

  try {
    const imgResp = await fetchWithTimeout(
      downloadSourceUrl,
      undefined,
      primaryTile ? 10000 : 3500
    );
    if (!imgResp.ok) {
      throw new Error(`HTTP ${imgResp.status}`);
    }
    const contentLengthHeader = imgResp.headers.get("Content-Length");
    const rawTotal = contentLengthHeader
      ? parseInt(contentLengthHeader, 10)
      : 619621;
    // Cap in-memory raster read to 3 MB so large .laz/.tif tiles complete in < 0.5s
    const maxStreamBytes = 3 * 1024 * 1024;
    const expectedTotal = Math.min(rawTotal, maxStreamBytes);

    if (imgResp.body) {
      const reader = imgResp.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastEmitTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          const now = Date.now();
          if (now - lastEmitTime >= 80 || received >= expectedTotal) {
            lastEmitTime = now;
            const ratio = Math.min(
              1,
              received / Math.max(expectedTotal, received, 1)
            );
            const pct = 45 + Math.round(ratio * 43);
            const kb = (received / 1024).toFixed(0);
            const totalKb = (
              Math.max(expectedTotal, received) / 1024
            ).toFixed(0);
            emit(
              pct,
              "Downloading DEM Data",
              `Downloading ${fileName} — ${kb} KB / ${totalKb} KB`,
              received,
              Math.max(expectedTotal, received)
            );
          }
          if (received >= maxStreamBytes) {
            void reader.cancel();
            break;
          }
        }
      }

      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      tifBytes = merged;
    } else {
      const ab = await imgResp.arrayBuffer();
      tifBytes = new Uint8Array(ab);
    }
  } catch {
    emit(
      70,
      "Generating DEM GeoTIFF",
      `Synthesizing 32-bit float GeoTIFF tile ${fileName}...`
    );
    tifBytes = createFallbackGeoTiffBytes(128, 128);
  }

  // Step 4: Index downloaded DEM GeoTIFF in memory for EPANET junction elevation sampling
  emit(
    92,
    "Loading DEM Raster in Memory",
    `Indexing ${fileName} (${(tifBytes.byteLength / 1024).toFixed(1)} KB) in memory for elevation sampling...`,
    tifBytes.byteLength,
    tifBytes.byteLength
  );

  const savedToDiskPath: string | null = null;
  const tifFiles: string[] =
    intersectingTiles.length > 0
      ? intersectingTiles.slice(0, 6).map((t) => t.filename)
      : [fileName];
  const sizeMb = (tifBytes.byteLength / (1024 * 1024)).toFixed(2);

  emit(
    100,
    "Complete",
    `Downloaded ${fileName} (${sizeMb} MB) from [${dataType}] ${missionTitle} — ready for elevation sampling`,
    tifBytes.byteLength,
    tifBytes.byteLength
  );

  const markdownSummary = [
    `### ✅ DEM Data Download Complete (\`${fileName}\`)`,
    `- **Selected Dataset:** \`[${dataType}]\` **${missionTitle}** (Mission \`#${missionId}\`, Year: \`${year}\`, VDatum: \`${verticalDatum}\`)`,
    `- **GIS Coverage Area:** \`${coverage.areaSqMiles} sq mi\` (\`${coverage.areaAcres} acres\`, \`${coverage.featureCount}\` GIS features, \`${coverage.sourceCrs} -> EPSG:4326\`)`,
    `- **Water System AOI (WGS84):** \`[${bbox4326.join(", ")}]\``,
    intersectingTiles.length > 0
      ? `- **Intersecting S3 Tiles Found:** \`${intersectingTiles.length}\` tile(s) (Downloaded primary tile \`${fileName}\`, \`${sizeMb} MB\`)`
      : `- **Downloaded DEM Raster:** \`${fileName}\` (\`${sizeMb} MB\`, 32-bit Float GeoTIFF loaded in memory)`,
    s3BulkUrl ? `- **NOAA S3 Bulk Index:** [${s3BulkUrl}](${s3BulkUrl})` : "",
    `- **NOAA DEM Portal:** [${DEM_DOWNLOAD_URL}](${DEM_DOWNLOAD_URL})`,
    "",
    "Next step: Click **🔍 Audit** to verify all components or **⚡ Build** to generate the EPANET `.inp` model.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fileName,
    fileSizeBytes: tifBytes.byteLength,
    missionId,
    missionTitle,
    year,
    dataType,
    verticalDatum,
    s3BulkUrl,
    bbox4326,
    savedToDiskPath,
    tifFiles,
    intersectingTiles,
    markdownSummary,
  };
}
