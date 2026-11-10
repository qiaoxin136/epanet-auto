import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  AmplifyStoredInpFile,
  BEDROCK_ENGINE_CONFIG,
  ChatImageAttachment,
  ChatMessage,
  ConversationThread,
  ExecutionMode,
  fetchInpFileContentFromAmplifyStorage,
  listInpFilesInAmplifyStorage,
  loadInpFromAmplifyBackend,
  queryBedrockGpt6Sol,
  syncInpToAmplifyBackend,
} from "./bedrockEngine";
import {
  AuditReport,
  BuildEpanetResult,
  DEM_DOWNLOAD_URL,
  DemDownloadProgress,
  DemIntersectingTile,
  DownloadedDemRaster,
  GisCoverageSummary,
  NoaaDemDatasetOption,
  UploadedLayerInfo,
  WaterLayerKey,
  auditWaterSystem,
  buildEpanetModel,
  computeGisCoverageForWaterSystem,
  createSampleWaterSystemLayers,
  discoverDemOptionsForWaterSystem,
  downloadDemForWaterSystem,
  getLatestDownloadedDemRaster,
  isLikelyPipeJsonFile,
  parseWaterJsonFile,
  recalculateBuildResultFromInp,
} from "./epanetBuilder";
import { extractPdfContent } from "./pdfExtractor";

const STORAGE_KEY = "epanet_auto_gpt6_sol_threads_v1";
const WATER_JSON_FOLDER_STORAGE_KEY = "epanet_water_json_folder_v2";
const DEFAULT_GASPARILLA_GIS_FOLDER =
  "D:\\Jiang Feng\\Gasparilla Island\\gis\\raw data\\Lat-Lon";

interface BuildStepItem {
  id: string;
  stepNumber: number;
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "error";
}

function createInitialBuildSteps(
  targetCrs: string = "EPSG:2264",
  modelName: string = "water_distribution_model"
): BuildStepItem[] {
  return [
    {
      id: "step-ingest",
      stepNumber: 1,
      title: "Ingest & Audit Water System JSON Layers",
      detail: "Verify pipe, tank, pump, water demand, pressure zone, WTP & hydrant layers",
      status: "pending",
    },
    {
      id: "step-crs-ids",
      stepNumber: 2,
      title: "Reproject State Plane CRS & Standardize FacilityIDs",
      detail: `Reproject to ${targetCrs || "EPSG:2264"} (ftUS) & assign P00001, N0001, T001, pump001, WTP001, H00001, PZ01`,
      status: "pending",
    },
    {
      id: "step-dem",
      stepNumber: 3,
      title: "Sample DEM GeoTIFF Elevations",
      detail: "Extract ground elevations (ft) strictly from the downloaded DEM GeoTIFF",
      status: "pending",
    },
    {
      id: "step-topology",
      stepNumber: 4,
      title: "Build Pipe Topology & Auto-Connect Tanks / Pumps",
      detail: "Snap pipe endpoints to junctions, add P_T001 tank leads & 3-point pump curves (C_pump001)",
      status: "pending",
    },
    {
      id: "step-demand-pz",
      stepNumber: 5,
      title: "Allocate Customer Demands & Close PZ Boundaries",
      detail: "Allocate GPM/MGD demands to junctions; set interior pipes OPEN & boundary pipes CLOSED",
      status: "pending",
    },
    {
      id: "step-export-inp",
      stepNumber: 6,
      title: "Assemble & Validate EPANET 2.2 .inp File",
      detail: `Write [JUNCTIONS], [TANKS], [PIPES], [PUMPS], [CURVES], [STATUS], [COORDINATES] to ${
        modelName.trim() || "water_distribution_model"
      }.inp`,
      status: "pending",
    },
  ];
}

function createInitialThread(): ConversationThread {
  const now = new Date().toISOString();
  return {
    id: `thread-${Date.now()}`,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function formatInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={idx} className="inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function FormattedMarkdown({
  content,
  onCopyCode,
  copiedSnippet,
}: {
  content: string;
  onCopyCode: (code: string) => void;
  copiedSnippet: string | null;
}) {
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-content">
      {segments.map((segment, index) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const lines = segment.slice(3, -3).trim().split("\n");
          const firstLine = lines[0]?.trim() || "";
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const lang = hasLang ? firstLine : "text";
          const codeBody = hasLang ? lines.slice(1).join("\n") : lines.join("\n");

          return (
            <div key={index} className="code-block-wrapper">
              <div className="code-block-header">
                <span>{lang}</span>
                <button
                  type="button"
                  className="code-copy-btn"
                  onClick={() => onCopyCode(codeBody)}
                >
                  {copiedSnippet === codeBody ? "Copied!" : "Copy code"}
                </button>
              </div>
              <pre className="code-block-pre">
                <code>{codeBody}</code>
              </pre>
            </div>
          );
        }

        const lines = segment.split("\n");
        const blocks: React.ReactNode[] = [];
        let i = 0;

        while (i < lines.length) {
          const line = lines[i];

          if (
            line.trim().startsWith("|") &&
            i + 1 < lines.length &&
            lines[i + 1].includes("---")
          ) {
            const headerCells = line
              .trim()
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((c) => c.trim());
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
              rows.push(
                lines[i]
                  .trim()
                  .replace(/^\||\|$/g, "")
                  .split("|")
                  .map((c) => c.trim())
              );
              i++;
            }
            blocks.push(
              <table key={`tbl-${i}`} className="md-table">
                <thead>
                  <tr>
                    {headerCells.map((cell, cIdx) => (
                      <th key={cIdx}>{formatInlineMarkdown(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{formatInlineMarkdown(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
            continue;
          }

          if (line.startsWith("### ")) {
            blocks.push(
              <h3 key={`h3-${i}`}>{formatInlineMarkdown(line.slice(4))}</h3>
            );
            i++;
            continue;
          }

          if (line.startsWith("#### ")) {
            blocks.push(
              <h4 key={`h4-${i}`}>{formatInlineMarkdown(line.slice(5))}</h4>
            );
            i++;
            continue;
          }

          if (line.startsWith("> ")) {
            blocks.push(
              <blockquote key={`bq-${i}`}>
                {formatInlineMarkdown(line.slice(2))}
              </blockquote>
            );
            i++;
            continue;
          }

          if (/^[-*]\s+/.test(line.trim())) {
            const items: string[] = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
              items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
              i++;
            }
            blocks.push(
              <ul key={`ul-${i}`}>
                {items.map((item, idx) => (
                  <li key={idx}>{formatInlineMarkdown(item)}</li>
                ))}
              </ul>
            );
            continue;
          }

          if (/^\d+\.\s+/.test(line.trim())) {
            const items: string[] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
              items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
              i++;
            }
            blocks.push(
              <ol key={`ol-${i}`}>
                {items.map((item, idx) => (
                  <li key={idx}>{formatInlineMarkdown(item)}</li>
                ))}
              </ol>
            );
            continue;
          }

          if (line.trim().length > 0) {
            blocks.push(<p key={`p-${i}`}>{formatInlineMarkdown(line)}</p>);
          }
          i++;
        }

        return <React.Fragment key={index}>{blocks}</React.Fragment>;
      })}
    </div>
  );
}

function isPdfAttachment(att: { name: string; mimeType: string }): boolean {
  return (
    att.mimeType === "application/pdf" || /\.pdf$/i.test(att.name || "")
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readImageFile(file: File): Promise<ChatImageAttachment> {
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");

  if (isPdf) {
    const buf = await file.arrayBuffer();
    const parsed = await extractPdfContent(buf);

    // Keep base64 dataUrl for smaller PDFs (< 2 MB) or use object URL so localStorage never overflows
    const dataUrl = await new Promise<string>((resolve) => {
      if (file.size > 2 * 1024 * 1024) {
        resolve(URL.createObjectURL(file));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => resolve(URL.createObjectURL(file));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });

    return {
      id: `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      mimeType: "application/pdf",
      sizeBytes: file.size,
      dataUrl,
      pageCount: parsed.pageCount,
      wordCount: parsed.wordCount,
      extractedText: parsed.extractedText,
      renderedPageImages: parsed.renderedPageImages,
      pdfJsExtracted: true,
    };
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const img = new Image();
      img.onload = () => {
        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: file.type || "image/png",
          sizeBytes: file.size,
          dataUrl,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: file.type || "image/png",
          sizeBytes: file.size,
          dataUrl,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

interface AppProps {
  user?: {
    username?: string;
    userId?: string;
    signInDetails?: {
      loginId?: string;
    };
  };
  signOut?: () => void;
}

function App({ user, signOut }: AppProps) {
  const userLabel =
    user?.signInDetails?.loginId || user?.username || "Authenticated User";
  const [threads, setThreads] = useState<ConversationThread[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ConversationThread[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage read errors
    }
    return [createInitialThread()];
  });

  const [activeThreadId, setActiveThreadId] = useState<string>(
    () => threads[0]?.id || ""
  );
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [isDraggingPic, setIsDraggingPic] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const mode: ExecutionMode = "bedrock";
  const [temperature, setTemperature] = useState<number>(0.7);
  const [systemPrompt, setSystemPrompt] = useState<string>(
    "You are Claude Opus 5.5 (anthropic.claude-opus-5-5) paired with the build-epanet hydraulic modeling agent on AWS Bedrock."
  );
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Right-hand Water System & build-epanet Panel state
  const [modelName, setModelName] = useState<string>("water_distribution_model");
  const [targetCrs, setTargetCrs] = useState<string>("EPSG:2882");
  const [demTileNames, setDemTileNames] = useState<string[]>([]);
  const [isDownloadingDem, setIsDownloadingDem] = useState<boolean>(false);
  const [isSearchingDemCoverage, setIsSearchingDemCoverage] =
    useState<boolean>(false);
  const [gisCoverage, setGisCoverage] = useState<GisCoverageSummary | null>(
    null
  );
  const [availableDemDatasets, setAvailableDemDatasets] = useState<
    NoaaDemDatasetOption[]
  >([]);
  const [selectedDemMissionId, setSelectedDemMissionId] = useState<
    string | null
  >(null);
  const [demIntersectingTiles, setDemIntersectingTiles] = useState<
    DemIntersectingTile[]
  >([]);
  const [downloadedDemRaster, setDownloadedDemRaster] =
    useState<DownloadedDemRaster | null>(null);
  const [demDownloadProgress, setDemDownloadProgress] =
    useState<DemDownloadProgress | null>(null);
  const [demDownloadError, setDemDownloadError] = useState<string | null>(null);
  const [waterJsonFolder, setWaterJsonFolder] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(WATER_JSON_FOLDER_STORAGE_KEY);
      if (saved && saved.trim()) return saved.trim();
    } catch {
      // Ignore storage error
    }
    return DEFAULT_GASPARILLA_GIS_FOLDER;
  });
  const [waterLayers, setWaterLayers] = useState<
    Partial<Record<WaterLayerKey, UploadedLayerInfo>>
  >({});
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [buildResult, setBuildResult] = useState<BuildEpanetResult | null>(null);
  const [inpModifiedByBedrockAt, setInpModifiedByBedrockAt] = useState<
    string | null
  >(null);
  const [isUploadingInp, setIsUploadingInp] = useState<boolean>(false);
  const [inpUploadedToBackendAt, setInpUploadedToBackendAt] = useState<
    string | null
  >(null);
  const [amplifyStoredInpFiles, setAmplifyStoredInpFiles] = useState<
    AmplifyStoredInpFile[]
  >([]);
  const [isLoadingStoredInpFiles, setIsLoadingStoredInpFiles] =
    useState<boolean>(false);
  const [downloadingStoredFileName, setDownloadingStoredFileName] = useState<
    string | null
  >(null);
  const [isBuildingModel, setIsBuildingModel] = useState<boolean>(false);
  const [buildProgressPercent, setBuildProgressPercent] = useState<number>(0);
  const [buildStageText, setBuildStageText] = useState<string>(
    "Ready to build EPANET .inp model"
  );
  const [buildDetailText, setBuildDetailText] = useState<string>(
    "Click ⚡ Build to run the 6-step build-epanet hydraulic modeling pipeline."
  );
  const [buildSteps, setBuildSteps] = useState<BuildStepItem[]>(() =>
    createInitialBuildSteps("EPSG:2882", "water_distribution_model")
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [folderScanStatus, setFolderScanStatus] = useState<string | null>(null);
  const [selectedDataFileKey, setSelectedDataFileKey] =
    useState<WaterLayerKey | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const picInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const folderJsonInputRef = useRef<HTMLInputElement | null>(null);
  const inpFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastScannedFolderRef = useRef<string>("");
  const demMapContainerRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<{
    remove: () => void;
    invalidateSize: () => void;
    fitBounds: (
      bounds: unknown,
      options?: { padding?: [number, number] }
    ) => void;
  } | null>(null);
  const leafletOverlayGroupRef = useRef<{
    clearLayers: () => void;
    addTo: (map: unknown) => unknown;
  } | null>(null);

  useEffect(() => {
    if (!gisCoverage || !demMapContainerRef.current) return;

    interface LeafletLayerInstance {
      addTo: (target: unknown) => LeafletLayerInstance;
      bindPopup: (html: string) => LeafletLayerInstance;
      getBounds: () => unknown;
    }

    interface LeafletStatic {
      map: (
        el: HTMLElement,
        opts?: { zoomControl?: boolean }
      ) => {
        setView: (center: [number, number], zoom: number) => unknown;
        remove: () => void;
        invalidateSize: () => void;
        fitBounds: (
          bounds: unknown,
          options?: { padding?: [number, number] }
        ) => void;
      };
      tileLayer: (
        url: string,
        opts: { maxZoom: number; attribution: string }
      ) => { addTo: (map: unknown) => unknown };
      layerGroup: () => {
        clearLayers: () => void;
        addTo: (map: unknown) => {
          clearLayers: () => void;
          addTo: (m: unknown) => unknown;
        };
      };
      geoJSON: (
        geojson: unknown,
        opts?: {
          style?: Record<string, unknown>;
          pointToLayer?: (
            feature: unknown,
            latlng: [number, number]
          ) => unknown;
        }
      ) => LeafletLayerInstance;
      circleMarker: (
        latlng: [number, number],
        opts: Record<string, unknown>
      ) => LeafletLayerInstance;
    }

    const L = (window as unknown as { L?: LeafletStatic }).L;
    if (!L) return;

    if (!leafletMapRef.current) {
      const [minLon, minLat, maxLon, maxLat] = gisCoverage.bbox4326;
      const centerLat = (minLat + maxLat) / 2;
      const centerLon = (minLon + maxLon) / 2;
      const mapInstance = L.map(demMapContainerRef.current, {
        zoomControl: true,
      });
      mapInstance.setView([centerLat, centerLon], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(mapInstance);
      leafletMapRef.current = mapInstance;
      leafletOverlayGroupRef.current = L.layerGroup().addTo(mapInstance);
    }

    const map = leafletMapRef.current;
    const group = leafletOverlayGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // 1. Draw NOAA-Compatible Pipe GIS Coverage AOI Polygon (same #38bdf8 style as main.d3nvwo119rglg1.amplifyapp.com)
    const aoiLayer = L.geoJSON(gisCoverage.noaaRestrictedGeoJson, {
      style: {
        color: "#0284c7",
        fillColor: "#38bdf8",
        weight: 2.5,
        fillOpacity: 0.16,
      },
    })
      .bindPopup(
        `<strong>Pipe GIS Coverage AOI (${gisCoverage.sourceFileName})</strong><br/>` +
          `Features: ${gisCoverage.featureCount.toLocaleString()}<br/>` +
          `Area: ${gisCoverage.areaSqMiles} sq mi (${gisCoverage.areaAcres} acres)<br/>` +
          `CRS: ${gisCoverage.sourceCrs} &rarr; EPSG:4326`
      )
      .addTo(group);

    // 2. Draw loaded Water System GIS features (pipes, tanks, pumps, pressure zones, demands)
    for (const overlay of gisCoverage.layerOverlays) {
      L.geoJSON(overlay.wgs84GeoJson, {
        style: {
          color: overlay.color,
          weight: overlay.key === "pipe" ? 2.5 : 2,
          fillOpacity: overlay.key === "pressure_zone" ? 0.12 : 0.25,
        },
        pointToLayer: (_feat: unknown, latlng: [number, number]) =>
          L.circleMarker(latlng, {
            radius:
              overlay.key === "tank" ||
              overlay.key === "pump" ||
              overlay.key === "wtp"
                ? 6
                : 4,
            color: "#ffffff",
            weight: 1.5,
            fillColor: overlay.color,
            fillOpacity: 0.9,
          }),
      })
        .bindPopup(
          `<strong>${overlay.label}</strong> (${overlay.fileName})<br/>` +
            `${overlay.featureCount} feature(s)`
        )
        .addTo(group);
    }

    // 3. Draw Intersecting NOAA S3 DEM Tile Footprints (#10b981 green, same as main.d3nvwo119rglg1.amplifyapp.com)
    for (const tile of demIntersectingTiles) {
      L.geoJSON(tile.geometry, {
        style: {
          color: "#10b981",
          fillColor: "#10b981",
          weight: 2,
          fillOpacity: 0.15,
        },
      })
        .bindPopup(
          `<strong>${tile.filename}</strong><br/>` +
            `<a href="${tile.url}" target="_blank" rel="noreferrer">Direct S3 DEM Tile Link</a>`
        )
        .addTo(group);
    }

    try {
      const bounds = aoiLayer.getBounds();
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [22, 22] });
      setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [22, 22] });
      }, 120);
    } catch {
      // Ignore bounds error
    }
  }, [gisCoverage, demIntersectingTiles]);

  // Persist waterJsonFolder and auto-scan on startup so pipe.json is ready
  useEffect(() => {
    try {
      if (waterJsonFolder.trim()) {
        localStorage.setItem(
          WATER_JSON_FOLDER_STORAGE_KEY,
          waterJsonFolder.trim()
        );
      }
    } catch {
      // Ignore storage error
    }
  }, [waterJsonFolder]);

  useEffect(() => {
    void (async () => {
      const initial = await scanLocalWaterJsonFolder(waterJsonFolder);
      if (Object.keys(initial).length === 0) {
        const fallbackFolder = "D:\\AI\\agent\\epanet-auto\\water-json";
        if (waterJsonFolder !== fallbackFolder) {
          setWaterJsonFolder(fallbackFolder);
          await scanLocalWaterJsonFolder(fallbackFolder);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If pipe.json is loaded/updated while DEM coverage is displayed, recompute coverage strictly from pipe.json
  useEffect(() => {
    if (!gisCoverage || !waterLayers.pipe) return;
    const updatedCoverage = computeGisCoverageForWaterSystem(
      { pipe: waterLayers.pipe },
      targetCrs
    );
    setGisCoverage(updatedCoverage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterLayers.pipe, targetCrs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch {
      try {
        const compactThreads = threads.map((t, idx) =>
          idx === 0
            ? t
            : {
                ...t,
                messages: t.messages.map((m) => ({
                  ...m,
                  attachments: m.attachments?.map((a) => ({
                    ...a,
                    renderedPageImages: a.renderedPageImages?.slice(0, 1),
                  })),
                })),
              }
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactThreads));
      } catch {
        // Ignore storage quota errors
      }
    }
  }, [threads]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || threads[0],
    [threads, activeThreadId]
  );

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [threads, searchQuery]);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages]);

  async function refreshAmplifyStoredInpFiles() {
    setIsLoadingStoredInpFiles(true);
    try {
      const files = await listInpFilesInAmplifyStorage();
      setAmplifyStoredInpFiles(files);
    } finally {
      setIsLoadingStoredInpFiles(false);
    }
  }

  // Load any active .inp file and list all .inp files stored in the AWS Amplify backend on startup
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, allFiles] = await Promise.all([
        loadInpFromAmplifyBackend(),
        listInpFilesInAmplifyStorage(),
      ]);
      if (cancelled) return;
      setAmplifyStoredInpFiles(allFiles);
      const initialInp = stored && stored.inpContent ? stored : allFiles[0];
      if (initialInp && initialInp.inpContent) {
        setBuildResult((prev) =>
          prev ??
          recalculateBuildResultFromInp(
            initialInp.inpContent!,
            null,
            initialInp.fileName,
            targetCrs
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetCrs]);

  function appendAgentConversationPair(userText: string, assistantMarkdown: string) {
    if (!activeThread) return;
    const targetId = activeThread.id;
    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: "user",
      content: userText,
      timestamp: now,
    };
    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now() + 1}-a`,
      role: "assistant",
      content: assistantMarkdown,
      timestamp: now,
      modelId: `${BEDROCK_ENGINE_CONFIG.modelId} · build-epanet`,
      inferenceProfileId: BEDROCK_ENGINE_CONFIG.inferenceProfileId,
      source: "aws-bedrock",
      latencyMs: 185,
      promptTokens: Math.ceil(userText.length / 4),
      completionTokens: Math.ceil(assistantMarkdown.length / 4),
    };

    setThreads((prev) =>
      prev.map((t) =>
        t.id === targetId
          ? {
              ...t,
              title:
                t.messages.length === 0
                  ? userText.slice(0, 40)
                  : t.title,
              updatedAt: now,
              messages: [...t.messages, userMsg, assistantMsg],
            }
          : t
      )
    );
  }

  function handleCopyText(text: string) {
    navigator.clipboard?.writeText(text);
    setCopiedSnippet(text);
    setTimeout(() => setCopiedSnippet(null), 1800);
  }

  function handleNewChat() {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }
    const fresh = createInitialThread();
    setThreads((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.id);
    setInput("");
    setPendingImages([]);
    textareaRef.current?.focus();
  }

  function handleDeleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fallback = createInitialThread();
        setActiveThreadId(fallback.id);
        return [fallback];
      }
      if (id === activeThreadId) {
        setActiveThreadId(remaining[0].id);
      }
      return remaining;
    });
  }

  async function handleAddPictureFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type === "application/pdf" ||
        /\.(png|jpe?g|webp|gif|svg|bmp|pdf)$/i.test(f.name)
    );
    if (files.length === 0) return;

    const loaded = await Promise.all(files.map((f) => readImageFile(f)));
    setPendingImages((prev) => [...prev, ...loaded]);
    textareaRef.current?.focus();
  }

  function handleChatDragOver(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingPic) {
      setIsDraggingPic(true);
    }
  }

  function handleChatDragLeave(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) {
      setIsDraggingPic(false);
    }
  }

  async function handleChatDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPic(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleAddPictureFiles(e.dataTransfer.files);
    }
  }

  async function handleUploadWaterJsonFiles(
    fileList: FileList | File[],
    forcedKey?: WaterLayerKey
  ) {
    setUploadError(null);
    setFolderScanStatus(null);
    const files = Array.from(fileList).filter(
      (f) => /\.(json|geojson)$/i.test(f.name) || Boolean(forcedKey)
    );
    if (files.length === 0) return;

    // If selected via directory picker (webkitRelativePath), update waterJsonFolder if not already set
    const firstRel = (files[0] as File & { webkitRelativePath?: string })
      .webkitRelativePath;
    if (firstRel && firstRel.includes("/")) {
      const folderName = firstRel.split("/")[0];
      if (folderName && !waterJsonFolder.trim()) {
        setWaterJsonFolder(`D:\\AI\\agent\\epanet-auto\\${folderName}`);
      }
    }

    const updated: Partial<Record<WaterLayerKey, UploadedLayerInfo>> = {};

    for (const file of files) {
      try {
        const rawText = await file.text();
        const info = parseWaterJsonFile(file.name, rawText, forcedKey);
        if (
          !forcedKey &&
          info.key === "pipe" &&
          files.length > 1 &&
          !isLikelyPipeJsonFile(file.name, info.data)
        ) {
          continue;
        }
        if (
          !forcedKey &&
          info.key === "pipe" &&
          updated.pipe &&
          updated.pipe.fileName.toLowerCase() === "pipe.json" &&
          file.name.toLowerCase() !== "pipe.json"
        ) {
          continue;
        }
        updated[info.key] = info;
      } catch (err) {
        setUploadError(
          err instanceof Error ? err.message : `Failed to parse ${file.name}`
        );
      }
    }

    if (Object.keys(updated).length > 0) {
      setWaterLayers((prev) => ({ ...prev, ...updated }));
      setFolderScanStatus(
        `Loaded ${Object.keys(updated).length} JSON layer(s) (${Object.values(
          updated
        )
          .map((u) => u?.fileName)
          .join(", ")})`
      );
    }
  }

  async function scanLocalWaterJsonFolder(
    folderPathToScan: string
  ): Promise<Partial<Record<WaterLayerKey, UploadedLayerInfo>>> {
    const trimmedFolder = folderPathToScan.trim();
    if (!trimmedFolder) return {};

    setUploadError(null);
    setFolderScanStatus(null);

    try {
      const resp = await fetch("/api/local-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderPath: trimmedFolder,
          kind: "water-json",
        }),
      });
      const data = (await resp.json()) as {
        exists?: boolean;
        folderPath?: string;
        files?: Array<{ name: string; content: string }>;
        error?: string;
      };

      if (!data.exists) {
        setUploadError(
          data.error || `Folder not found on local drive: ${trimmedFolder}`
        );
        return {};
      }

      const files = data.files || [];
      if (files.length === 0) {
        setUploadError(
          `No .json or .geojson files found in local folder: ${
            data.folderPath || trimmedFolder
          }`
        );
        return {};
      }

      const updated: Partial<Record<WaterLayerKey, UploadedLayerInfo>> = {};
      for (const file of files) {
        const lowerName = file.name.toLowerCase();
        if (
          files.length > 1 &&
          (lowerName.includes("backflow") ||
            lowerName.includes("fitting") ||
            lowerName.includes("valve") ||
            lowerName.includes("network_structure") ||
            lowerName.includes("psite"))
        ) {
          continue;
        }
        try {
          const info = parseWaterJsonFile(file.name, file.content);
          if (
            info.key === "pipe" &&
            files.length > 1 &&
            !isLikelyPipeJsonFile(file.name, info.data)
          ) {
            continue;
          }
          if (
            info.key === "pipe" &&
            updated.pipe &&
            updated.pipe.fileName.toLowerCase() === "pipe.json" &&
            lowerName !== "pipe.json"
          ) {
            continue;
          }
          updated[info.key] = info;
        } catch (err) {
          setUploadError(
            err instanceof Error ? err.message : `Failed to parse ${file.name}`
          );
        }
      }

      if (Object.keys(updated).length > 0) {
        lastScannedFolderRef.current = trimmedFolder;
        setWaterLayers((prev) => ({ ...prev, ...updated }));
        setFolderScanStatus(
          `Scanned "${data.folderPath || trimmedFolder}" → loaded ${
            Object.keys(updated).length
          } layer(s)`
        );
      }

      return updated;
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? err.message
          : `Unable to scan local folder: ${trimmedFolder}`
      );
      return {};
    }
  }

  async function handleDemDownloadClick() {
    if (isDownloadingDem || isSearchingDemCoverage) return;

    setIsSearchingDemCoverage(true);
    setDemDownloadError(null);
    setDemIntersectingTiles([]);
    setDemDownloadProgress({
      percent: 15,
      stage: "Mapping Pipe GIS Data Coverage",
      detail:
        "Extracting pipe.json coverage polygon (EPSG:4326) and querying NOAA Digital Coast catalog...",
    });

    try {
      let activeLayers = waterLayers;
      const trimmedFolder = waterJsonFolder.trim();
      if (
        trimmedFolder &&
        (!activeLayers.pipe || lastScannedFolderRef.current !== trimmedFolder)
      ) {
        const scanned = await scanLocalWaterJsonFolder(trimmedFolder);
        if (Object.keys(scanned).length > 0) {
          activeLayers = { ...activeLayers, ...scanned };
        } else {
          setUploadError(null);
        }
      }
      if (!activeLayers.pipe) {
        const sampleLayers = createSampleWaterSystemLayers();
        activeLayers = { ...activeLayers, pipe: sampleLayers.pipe };
      }

      const discovered = await discoverDemOptionsForWaterSystem({
        layers: activeLayers,
        targetCrs,
      });

      setGisCoverage(discovered.coverage);
      setAvailableDemDatasets(discovered.datasets);

      const defaultOption =
        discovered.datasets.find((d) => d.recommended) ||
        discovered.datasets[0] ||
        null;
      setSelectedDemMissionId(defaultOption ? defaultOption.missionId : null);

      setDemDownloadProgress({
        percent: 35,
        stage: "Select Available DEM Dataset",
        detail: `Coverage from ${discovered.coverage.sourceFileName} (${discovered.coverage.featureCount.toLocaleString()} features): ${discovered.coverage.areaSqMiles} sq mi (${discovered.coverage.areaAcres} acres). Found ${discovered.datasets.length} NOAA DEM/LiDAR dataset(s) — choose one below.`,
      });

      const optionsMarkdown = discovered.datasets
        .map(
          (d, idx) =>
            `${idx + 1}. **[${d.dataType}] ${d.title}** — Mission \`#${d.missionId}\` | Year: \`${d.year}\` | VDatum: \`${d.verticalDatum}\`${
              d.bulkDownloadUrl ? " | `Direct S3 Bulk Tiles`" : ""
            }${d.recommended ? " *(Recommended)*" : ""}`
        )
        .join("\n");

      appendAgentConversationPair(
        `Show pipe.json GIS coverage map and search available DEM options on ${DEM_DOWNLOAD_URL}`,
        [
          `### 🗺️ Pipe GIS Coverage & Available NOAA DEM Options`,
          `- **Coverage Source File:** \`${discovered.coverage.sourceFileName}\` (\`${discovered.coverage.featureCount.toLocaleString()}\` pipe features)`,
          `- **Detected CRS:** \`${discovered.coverage.sourceCrs} → EPSG:4326\``,
          `- **Pipe Coverage Area:** \`${discovered.coverage.areaSqMiles} sq mi\` (\`${discovered.coverage.areaAcres} acres\`)`,
          `- **Vertices:** \`${discovered.coverage.originalVertexCount}\` (simplified to \`${discovered.coverage.simplifiedVertexCount}\`)`,
          `- **WGS84 Bounding Box:** \`[${discovered.coverage.bbox4326.join(", ")}]\``,
          "",
          `#### Available Datasets (${discovered.datasets.length} found) — Please choose one in Step 2:`,
          optionsMarkdown,
        ].join("\n")
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to search GIS DEM coverage.";
      setDemDownloadError(msg);
      setDemDownloadProgress(null);
    } finally {
      setIsSearchingDemCoverage(false);
    }
  }

  async function handleConfirmDemDatasetDownload(
    overrideDataset?: NoaaDemDatasetOption
  ) {
    if (isDownloadingDem) return;

    const chosenDataset =
      overrideDataset ||
      availableDemDatasets.find((d) => d.missionId === selectedDemMissionId) ||
      availableDemDatasets[0];

    if (!chosenDataset) return;

    setSelectedDemMissionId(chosenDataset.missionId);
    setIsDownloadingDem(true);
    setDemDownloadError(null);
    setDemDownloadProgress({
      percent: 10,
      stage: "Initializing Selected DEM Download",
      detail: `Preparing download for [${chosenDataset.dataType}] ${chosenDataset.title} (Mission #${chosenDataset.missionId})...`,
    });

    try {
      let activeLayers = waterLayers;
      if (Object.keys(activeLayers).length === 0) {
        activeLayers = createSampleWaterSystemLayers();
      }

      const result = await downloadDemForWaterSystem({
        layers: activeLayers,
        targetCrs,
        selectedDataset: chosenDataset,
        coverage: gisCoverage || undefined,
        onProgress: (prog) => {
          setDemDownloadProgress(prog);
        },
      });

      if (result.intersectingTiles.length > 0) {
        setDemIntersectingTiles(result.intersectingTiles);
      }
      setDownloadedDemRaster(result.demRaster);

      setDemTileNames((prev) =>
        Array.from(new Set([...prev, ...result.tifFiles]))
      );

      appendAgentConversationPair(
        `Download selected DEM dataset: [${chosenDataset.dataType}] ${chosenDataset.title} (Mission #${chosenDataset.missionId})`,
        result.markdownSummary
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to download DEM tile.";
      setDemDownloadError(msg);
      setDemDownloadProgress(null);
    } finally {
      setIsDownloadingDem(false);
    }
  }

  async function handleRunAudit() {
    let activeLayers = waterLayers;
    if (Object.keys(activeLayers).length === 0 && waterJsonFolder.trim()) {
      const scanned = await scanLocalWaterJsonFolder(waterJsonFolder);
      if (Object.keys(scanned).length > 0) {
        activeLayers = { ...activeLayers, ...scanned };
      }
    }

    const report = auditWaterSystem(
      activeLayers,
      "Cloud DEM (In-Memory)",
      demTileNames,
      targetCrs,
      waterJsonFolder
    );
    setAuditReport(report);
    appendAgentConversationPair(
      "Audit water system JSON files and DEM elevation readiness for missing components.",
      report.markdownReport
    );
  }

  async function handleRunBuild() {
    if (isBuildingModel) return;

    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    setIsBuildingModel(true);
    const initialSteps = createInitialBuildSteps(targetCrs, modelName);
    setBuildSteps(
      initialSteps.map((s, idx) =>
        idx === 0 ? { ...s, status: "running" } : { ...s, status: "pending" }
      )
    );
    setBuildProgressPercent(12);
    setBuildStageText("Step 1/6: Ingesting & Auditing Water System JSONs...");
    setBuildDetailText(
      `Scanning water system layers from ${
        waterJsonFolder.trim() || "loaded browser layers"
      }...`
    );

    try {
      let activeLayers = waterLayers;
      if (Object.keys(activeLayers).length === 0 && waterJsonFolder.trim()) {
        const scanned = await scanLocalWaterJsonFolder(waterJsonFolder);
        if (Object.keys(scanned).length > 0) {
          activeLayers = { ...activeLayers, ...scanned };
        }
      }
      await pause(220);

      const report = auditWaterSystem(
        activeLayers,
        "Cloud DEM (In-Memory)",
        demTileNames,
        targetCrs,
        waterJsonFolder
      );
      setAuditReport(report);
      const layerCount = Object.keys(activeLayers).length;

      // Advance to Step 2
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 0) {
            return {
              ...s,
              status: "completed",
              detail: `Audited ${layerCount} layer(s) (${report.overallStatus})`,
            };
          }
          if (idx === 1) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(30);
      setBuildStageText(
        `Step 2/6: Reprojecting to ${targetCrs} & Standardizing FacilityIDs...`
      );
      setBuildDetailText(
        "Assigning sequential IDs: P00001…, N0001…, T001…, pump001…, WTP001…, H00001…, PZ01…"
      );
      await pause(240);

      // Advance to Step 3: DEM Sampling (ONLY using the downloaded DEM GeoTIFF)
      const activeDemRaster =
        downloadedDemRaster ?? getLatestDownloadedDemRaster();

      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 1) {
            return {
              ...s,
              status: "completed",
              detail: `CRS ${targetCrs} (ftUS) · Standardizing P00001…, N0001…, T001…, pump001…`,
            };
          }
          if (idx === 2) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(48);
      setBuildStageText("Step 3/6: Sampling DEM GeoTIFF Elevations...");

      if (!activeDemRaster) {
        const demErrMsg =
          "No downloaded DEM GeoTIFF found. Please download DEM data in Step 2 first — Step 3 only uses the downloaded DEM to sample elevations.";
        setBuildStageText("Step 3/6 Blocked: Downloaded DEM Required");
        setBuildDetailText(demErrMsg);
        setBuildSteps((prev) =>
          prev.map((s, idx) =>
            idx === 2
              ? {
                  ...s,
                  status: "error",
                  detail: demErrMsg,
                }
              : s
          )
        );
        return;
      }

      setBuildDetailText(
        `Sampling ground elevations solely from downloaded DEM ${activeDemRaster.fileName}...`
      );
      await pause(240);

      // Compute full build result strictly using the downloaded DEM GeoTIFF raster
      const built = buildEpanetModel(
        modelName,
        targetCrs,
        activeDemRaster.fileName,
        activeLayers,
        waterJsonFolder,
        activeDemRaster,
        true
      );

      // Update Step 2 with exact FacilityID ranges and advance to Step 4: Topology & Auto-Connect
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 1) {
            return {
              ...s,
              status: "completed",
              detail: `CRS ${built.crs} (ftUS) · Pipes ${built.facilityIdRanges.Pipes} · Nodes ${built.facilityIdRanges.Junctions}`,
            };
          }
          if (idx === 2) {
            return {
              ...s,
              status: "completed",
              detail: `Sampled ${built.stats.demSampledNodes} junctions & ${built.stats.tanks} tank(s) solely from downloaded DEM ${activeDemRaster.fileName} (${built.stats.minSampledElevFt.toFixed(2)}–${built.stats.maxSampledElevFt.toFixed(2)} ft ${activeDemRaster.verticalDatum})`,
            };
          }
          if (idx === 3) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(66);
      setBuildStageText(
        "Step 4/6: Building Pipe Topology & Auto-Connecting Tanks / Pumps..."
      );
      setBuildDetailText(
        `Connecting ${built.stats.pipes} pipes, ${built.stats.tanks} tank connector(s), and ${built.stats.pumps} pump curve(s)...`
      );
      await pause(240);

      // Advance to Step 5: Demands & Pressure Zone Boundaries
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 3) {
            return {
              ...s,
              status: "completed",
              detail: `${built.stats.junctions} junctions, ${built.stats.pipes} pipes, ${built.stats.tanks} tank leads, ${built.stats.pumpCurves} pump curves`,
            };
          }
          if (idx === 4) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(84);
      setBuildStageText(
        "Step 5/6: Allocating Customer Demands & Closing PZ Boundaries..."
      );
      setBuildDetailText(
        `Allocating ${built.stats.totalDemandGpm} GPM demand; setting ${built.stats.openPipes} OPEN & ${built.stats.closedBoundaryPipes} CLOSED boundary pipes...`
      );
      await pause(240);

      // Advance to Step 6: Assemble .inp
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 4) {
            return {
              ...s,
              status: "completed",
              detail: `Total demand: ${built.stats.totalDemandGpm} GPM · OPEN pipes: ${built.stats.openPipes} · Closed PZ boundary pipes: ${built.stats.closedBoundaryPipes}`,
            };
          }
          if (idx === 5) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(95);
      setBuildStageText(`Step 6/6: Exporting ${built.inpFileName}...`);
      setBuildDetailText(
        `Writing EPANET 2.2 sections to ${built.inpFileName}...`
      );
      await pause(200);

      setBuildSteps((prev) =>
        prev.map((s, idx) =>
          idx === 5
            ? {
                ...s,
                status: "completed",
                detail: `Generated ${built.inpFileName} (${(
                  built.inpContent.length / 1024
                ).toFixed(1)} KB) — ready to download`,
              }
            : s
        )
      );
      setBuildProgressPercent(100);
      setBuildStageText(`Build Complete — ${built.inpFileName}`);
      setBuildDetailText(
        `Successfully built ${built.inpFileName} with ${built.stats.junctions} junctions, ${built.stats.pipes} pipes, ${built.stats.tanks} tank(s), and ${built.stats.pumps} pump(s).`
      );
      setBuildResult(built);
      setInpModifiedByBedrockAt(null);
      void (async () => {
        await syncInpToAmplifyBackend(
          built.inpFileName,
          built.inpContent,
          "Built by build-epanet"
        );
        await refreshAmplifyStoredInpFiles();
      })();

      appendAgentConversationPair(
        `Run build-epanet agent to build ${built.inpFileName} (CRS ${targetCrs})`,
        built.markdownSummary
      );
    } finally {
      setIsBuildingModel(false);
    }
  }

  function triggerLocalInpDownload(fileName: string, inpContent: string) {
    const cleanName = fileName.toLowerCase().endsWith(".inp")
      ? fileName
      : `${fileName.replace(/\.[^.]+$/, "")}.inp`;
    const blob = new Blob([inpContent], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cleanName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownloadInpFile() {
    if (!buildResult) return;
    triggerLocalInpDownload(buildResult.inpFileName, buildResult.inpContent);
  }

  async function handleDownloadStoredInpFile(item: AmplifyStoredInpFile) {
    setDownloadingStoredFileName(item.fileName);
    try {
      const content =
        (await fetchInpFileContentFromAmplifyStorage(item)) ||
        (buildResult &&
        buildResult.inpFileName.toLowerCase() === item.fileName.toLowerCase()
          ? buildResult.inpContent
          : null);
      if (!content) {
        setUploadError(
          `Unable to retrieve "${item.fileName}" from AWS Amplify Storage.`
        );
        return;
      }
      triggerLocalInpDownload(item.fileName, content);
    } finally {
      setDownloadingStoredFileName(null);
    }
  }

  async function handleSelectStoredInpFile(item: AmplifyStoredInpFile) {
    const content = await fetchInpFileContentFromAmplifyStorage(item);
    if (!content) return;
    const parsed = recalculateBuildResultFromInp(
      content,
      buildResult,
      item.fileName,
      targetCrs
    );
    setModelName(item.fileName.replace(/\.inp$/i, ""));
    setBuildResult(parsed);
    setInpModifiedByBedrockAt(null);
  }

  async function handleUploadInpFile(file: File) {
    setIsUploadingInp(true);
    setUploadError(null);
    try {
      const rawText = await file.text();
      if (!rawText.trim()) {
        setUploadError(`Selected file "${file.name}" is empty.`);
        return;
      }
      const cleanFileName = file.name.toLowerCase().endsWith(".inp")
        ? file.name
        : `${file.name.replace(/\.[^.]+$/, "")}.inp`;
      const parsedResult = recalculateBuildResultFromInp(
        rawText,
        buildResult,
        cleanFileName,
        targetCrs
      );
      setModelName(cleanFileName.replace(/\.inp$/i, ""));
      setBuildResult(parsedResult);
      setInpModifiedByBedrockAt(null);

      const synced = await syncInpToAmplifyBackend(
        cleanFileName,
        rawText,
        "Uploaded via inp Upload"
      );
      await refreshAmplifyStoredInpFiles();
      const ts = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setInpUploadedToBackendAt(
        synced
          ? `${cleanFileName} uploaded to AWS Amplify Backend (${ts})`
          : `${cleanFileName} loaded & queued for AWS Amplify Backend (${ts})`
      );

      appendAgentConversationPair(
        `Upload EPANET .inp file "${cleanFileName}" to AWS Amplify backend`,
        [
          `### ☁️ Uploaded \`${cleanFileName}\` to AWS Amplify Backend`,
          "",
          `- **File Size:** \`${(rawText.length / 1024).toFixed(1)} KB\``,
          `- **Junctions:** \`${parsedResult.stats.junctions}\` · **Pipes:** \`${parsedResult.stats.pipes}\` (\`OPEN\`: ${parsedResult.stats.openPipes}, \`CLOSED\`: ${parsedResult.stats.closedBoundaryPipes})`,
          `- **Tanks:** \`${parsedResult.stats.tanks}\` · **Pumps:** \`${parsedResult.stats.pumps}\` · **Total Demand:** \`${parsedResult.stats.totalDemandGpm} GPM\``,
          "",
          `\`${cleanFileName}\` is now stored in the AWS Amplify backend and connected to **Claude Opus 5.5 (\`anthropic.claude-opus-5-5\`)**. You can ask the AI in this chat to inspect or modify any section of the \`.inp\` file.`,
        ].join("\n")
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(`Failed to upload "${file.name}": ${msg}`);
    } finally {
      setIsUploadingInp(false);
    }
  }

  async function sendPrompt(
    promptText: string,
    existingHistory?: ChatMessage[],
    explicitAttachments?: ChatImageAttachment[]
  ) {
    const trimmed = promptText.trim();
    const activeAttachments = explicitAttachments ?? pendingImages;
    if (
      (!trimmed && activeAttachments.length === 0) ||
      isStreaming ||
      !activeThread
    ) {
      return;
    }

    // Intercept explicit audit / build chat requests so chat + right panel stay in sync
    const lowerPrompt = trimmed.toLowerCase();
    if (
      activeAttachments.length === 0 &&
      lowerPrompt.includes("audit") &&
      (lowerPrompt.includes("water") ||
        lowerPrompt.includes("epanet") ||
        lowerPrompt.includes("layer"))
    ) {
      setInput("");
      handleRunAudit();
      return;
    }
    if (
      activeAttachments.length === 0 &&
      (lowerPrompt === "build .inp" ||
        lowerPrompt === "build model" ||
        lowerPrompt === "run build-epanet")
    ) {
      setInput("");
      handleRunBuild();
      return;
    }

    // Ensure an active .inp model is available for AWS Bedrock to inspect or modify
    let currentBuild = buildResult;
    if (!currentBuild) {
      const activeLayers =
        Object.keys(waterLayers).length > 0
          ? waterLayers
          : createSampleWaterSystemLayers();
      currentBuild = buildEpanetModel(
        modelName,
        targetCrs,
        demTileNames.length > 0
          ? demTileNames.join(", ")
          : "Cloud DEM (In-Memory)",
        activeLayers,
        waterJsonFolder
      );
      setBuildResult(currentBuild);
      void (async () => {
        await syncInpToAmplifyBackend(
          currentBuild.inpFileName,
          currentBuild.inpContent,
          "Auto-Initialized"
        );
        await refreshAmplifyStoredInpFiles();
      })();
    }

    const attachedImages = [...activeAttachments];
    const baseMessages = existingHistory ?? activeThread.messages;
    const displayPrompt =
      trimmed ||
      `Attached ${attachedImages.length} file${
        attachedImages.length > 1 ? "s" : ""
      }: ${attachedImages.map((img) => img.name).join(", ")}`;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: "user",
      content: displayPrompt,
      timestamp: new Date().toISOString(),
      attachments: attachedImages.length > 0 ? attachedImages : undefined,
    };

    const assistantMessageId = `msg-${Date.now()}-a`;
    const placeholderAssistant: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "...",
      timestamp: new Date().toISOString(),
      modelId: BEDROCK_ENGINE_CONFIG.modelId,
      inferenceProfileId: BEDROCK_ENGINE_CONFIG.inferenceProfileId,
    };

    const nextMessages = [...baseMessages, userMessage, placeholderAssistant];
    const nextTitle =
      baseMessages.length === 0
        ? displayPrompt.length > 40
          ? `${displayPrompt.slice(0, 40)}...`
          : displayPrompt
        : activeThread.title;

    const targetThreadId = activeThread.id;

    setThreads((prev) =>
      prev.map((t) =>
        t.id === targetThreadId
          ? {
              ...t,
              title: nextTitle,
              updatedAt: new Date().toISOString(),
              messages: nextMessages,
            }
          : t
      )
    );

    setInput("");
    setPendingImages([]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const historyForModel = [...baseMessages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }));

      const result = await queryBedrockGpt6Sol({
        messages: historyForModel,
        systemPrompt,
        temperature,
        mode,
        activeInpContent: currentBuild.inpContent,
        activeInpFileName: currentBuild.inpFileName,
        signal: controller.signal,
        onToken: (partial) => {
          setThreads((prev) =>
            prev.map((t) =>
              t.id === targetThreadId
                ? {
                    ...t,
                    messages: t.messages.map((m) =>
                      m.id === assistantMessageId ? { ...m, content: partial } : m
                    ),
                  }
                : t
            )
          );
        },
      });

      if (result.updatedInpContent) {
        const updatedBuild = recalculateBuildResultFromInp(
          result.updatedInpContent,
          currentBuild,
          result.updatedInpFileName || currentBuild.inpFileName,
          targetCrs
        );
        setBuildResult(updatedBuild);
        setInpModifiedByBedrockAt(new Date().toLocaleTimeString());
        void refreshAmplifyStoredInpFiles();
      }

      setThreads((prev) =>
        prev.map((t) =>
          t.id === targetThreadId
            ? {
                ...t,
                updatedAt: new Date().toISOString(),
                messages: t.messages.map((m) =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        content: result.reply,
                        modelId: result.modelId,
                        inferenceProfileId: result.inferenceProfileId,
                        source: result.source,
                        latencyMs: result.latencyMs,
                        promptTokens: result.promptTokens,
                        completionTokens: result.completionTokens,
                        errorDetail: result.errorDetail,
                      }
                    : m
                ),
              }
            : t
        )
      );
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  function handleStopGeneration() {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }

  function handleRegenerate(assistantMsgIndex: number) {
    if (!activeThread || isStreaming) return;
    const priorMessages = activeThread.messages.slice(0, assistantMsgIndex);
    const lastUser = [...priorMessages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const historyBeforeLastUser = priorMessages.slice(
      0,
      priorMessages.lastIndexOf(lastUser)
    );
    sendPrompt(lastUser.content, historyBeforeLastUser, lastUser.attachments);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt(input);
    }
  }

  const loadedLayersCount = Object.keys(waterLayers).length;

  return (
    <div className="app-shell">
      {/* Left Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
        <div className="sidebar-top">
          <button type="button" className="new-chat-btn" onClick={handleNewChat}>
            <span className="new-chat-btn-left">
              <span className="brand-dot">C5</span>
              <span>New chat</span>
            </span>
            <span>+</span>
          </button>
          <input
            type="search"
            className="sidebar-search"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="sidebar-section-label">
          Conversations ({filteredThreads.length})
        </div>

        <div className="thread-list">
          {filteredThreads.map((thread) => (
            <div
              key={thread.id}
              className={`thread-item ${
                thread.id === activeThread?.id ? "active" : ""
              }`}
              onClick={() => setActiveThreadId(thread.id)}
            >
              <span className="thread-title">{thread.title}</span>
              <button
                type="button"
                className="thread-delete-btn"
                title="Delete chat"
                onClick={(e) => handleDeleteThread(thread.id, e)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Center Conversational Area (Always Open + Picture Drop Support) */}
      <main
        className="chat-main"
        onDragOver={handleChatDragOver}
        onDragLeave={handleChatDragLeave}
        onDrop={handleChatDrop}
      >
        {isDraggingPic && (
          <div className="pic-drop-overlay">
            <span>
              🖼️ / 📄 Drop picture or PDF file here to attach to Claude Opus 5.5
              conversation
            </span>
            <span style={{ fontSize: "0.82rem", color: "#047857" }}>
              Supports PDF, PNG, JPG, WEBP, GIF, SVG, BMP
            </span>
          </div>
        )}

        <header className="chat-topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              title="Toggle conversations sidebar"
            >
              ☰
            </button>
          </div>

          <div className="topbar-right">
            <span className="user-auth-pill" title={`Signed in as ${userLabel}`}>
              👤 {userLabel}
            </span>
            {signOut && (
              <button
                type="button"
                className="icon-btn signout-btn"
                onClick={() => signOut()}
                title="Sign out of AWS Amplify"
              >
                ⎋ Sign Out
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShowSettings((prev) => !prev)}
            >
              ⚙ {showSettings ? "Hide Settings" : "Settings"}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setRightPanelOpen((prev) => !prev)}
              title="Toggle Water System & build-epanet right panel"
            >
              {rightPanelOpen ? "⇥ Hide EPANET Panel" : "⇤ EPANET Panel"}
            </button>
          </div>
        </header>

        {showSettings && (
          <section className="settings-bar">
            <div className="settings-group grow">
              <label className="settings-label" htmlFor="sys-prompt">
                System Prompt ({BEDROCK_ENGINE_CONFIG.modelId})
              </label>
              <input
                id="sys-prompt"
                type="text"
                className="settings-input"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>
            <div className="settings-group">
              <label className="settings-label" htmlFor="temp-range">
                Temperature: {temperature.toFixed(2)}
              </label>
              <input
                id="temp-range"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
            </div>
          </section>
        )}

        <div className="chat-viewport">
          {!activeThread || activeThread.messages.length === 0 ? (
            <div className="welcome-container">
              <div className="welcome-logo">C5</div>
              <h1 className="welcome-title">What can I help with?</h1>
              <p className="welcome-subtitle">
                Conversational AI powered by <strong>Anthropic Claude Opus 5.5</strong> (
                <code>anthropic.claude-opus-5-5</code>) + <strong>build-epanet</strong> agent.
                Drop any picture file here or configure your water system JSON layers
                on the right panel.
              </p>
            </div>
          ) : (
            <div className="chat-column">
              {activeThread.messages.map((msg, index) =>
                msg.role === "user" ? (
                  <div key={msg.id} className="message-row user">
                    <div className="user-bubble">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="user-attachments-grid">
                          {msg.attachments.map((att) =>
                            isPdfAttachment(att) ? (
                              <div
                                key={att.id}
                                className="user-attachment-card pdf-card"
                              >
                                {att.renderedPageImages &&
                                  att.renderedPageImages.length > 0 && (
                                    <img
                                      src={att.renderedPageImages[0]}
                                      alt={`${att.name} Page 1`}
                                      style={{
                                        width: "100%",
                                        maxHeight: "110px",
                                        objectFit: "contain",
                                        background: "#ffffff",
                                        borderRadius: "6px",
                                        border: "1px solid #cbd5e1",
                                      }}
                                    />
                                  )}
                                <div className="user-pdf-header">
                                  <span className="user-pdf-icon">📄 PDF</span>
                                  <span className="user-pdf-meta">
                                    {formatFileSize(att.sizeBytes)}
                                    {att.pageCount
                                      ? ` · ${att.pageCount} pg`
                                      : ""}
                                    {att.renderedPageImages &&
                                    att.renderedPageImages.length > 0
                                      ? ` · 🖼️ ${att.renderedPageImages.length} visual pg`
                                      : ""}
                                    {typeof att.wordCount === "number" &&
                                    att.wordCount > 0
                                      ? ` · ${att.wordCount} words`
                                      : ""}
                                  </span>
                                </div>
                                <span
                                  className="user-attachment-caption"
                                  title={att.name}
                                >
                                  {att.name}
                                </span>
                                {att.dataUrl && (
                                  <a
                                    href={att.dataUrl}
                                    download={att.name}
                                    className="user-pdf-download-link"
                                  >
                                    ⬇ Download PDF
                                  </a>
                                )}
                              </div>
                            ) : (
                              <div key={att.id} className="user-attachment-card">
                                <img src={att.dataUrl} alt={att.name} />
                                <span className="user-attachment-caption">
                                  {att.name}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )}
                      <div>{msg.content}</div>
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="message-row assistant">
                    <div className="assistant-avatar">C5</div>
                    <div className="assistant-body">
                      <FormattedMarkdown
                        content={msg.content}
                        onCopyCode={handleCopyText}
                        copiedSnippet={copiedSnippet}
                      />
                      <div className="assistant-meta-bar">
                        <span className="meta-chip">
                          {msg.modelId || BEDROCK_ENGINE_CONFIG.modelId}
                        </span>
                        {msg.source && (
                          <span className="meta-chip">
                            {msg.source === "bedrock-error"
                              ? "Bedrock Notice"
                              : "AWS Bedrock Live"}
                          </span>
                        )}
                        {typeof msg.latencyMs === "number" && (
                          <span className="meta-chip">{msg.latencyMs} ms</span>
                        )}
                        {typeof msg.completionTokens === "number" && (
                          <span className="meta-chip">
                            {(msg.promptTokens || 0) + msg.completionTokens} tokens
                          </span>
                        )}
                        <button
                          type="button"
                          className="meta-action-btn"
                          onClick={() => handleCopyText(msg.content)}
                        >
                          {copiedSnippet === msg.content ? "✓ Copied" : "Copy"}
                        </button>
                        <button
                          type="button"
                          className="meta-action-btn"
                          disabled={isStreaming}
                          onClick={() => handleRegenerate(index)}
                        >
                          ↻ Regenerate
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}
              <div ref={bottomAnchorRef} />
            </div>
          )}
        </div>

        <footer className="composer-area">
          <div className="composer-box">
            <input
              ref={picInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) {
                  handleAddPictureFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
            <input
              ref={pdfInputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) {
                  handleAddPictureFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />

            {pendingImages.length > 0 && (
              <div className="composer-attachments">
                {pendingImages.map((img) =>
                  isPdfAttachment(img) ? (
                    <div key={img.id} className="composer-thumb pdf-thumb">
                      {img.renderedPageImages &&
                      img.renderedPageImages.length > 0 ? (
                        <img
                          src={img.renderedPageImages[0]}
                          alt={`${img.name} preview`}
                          style={{
                            width: "42px",
                            height: "42px",
                            objectFit: "cover",
                            background: "#ffffff",
                            borderRadius: "6px",
                            border: "1px solid #93c5fd",
                          }}
                        />
                      ) : (
                        <div className="composer-pdf-badge">📄 PDF</div>
                      )}
                      <div className="composer-pdf-info">
                        <span className="composer-thumb-name" title={img.name}>
                          {img.name}
                        </span>
                        <span className="composer-pdf-size">
                          {formatFileSize(img.sizeBytes)}
                          {img.pageCount ? ` · ${img.pageCount} pg` : ""}
                          {img.renderedPageImages &&
                          img.renderedPageImages.length > 0
                            ? ` · 🖼️ ${img.renderedPageImages.length} visual pg(s)`
                            : ""}
                          {typeof img.wordCount === "number" &&
                          img.wordCount > 0
                            ? ` · ${img.wordCount} words`
                            : " · AI Vision ready"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="composer-thumb-remove"
                        title="Remove PDF"
                        onClick={() =>
                          setPendingImages((prev) =>
                            prev.filter((item) => item.id !== img.id)
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div key={img.id} className="composer-thumb">
                      <img src={img.dataUrl} alt={img.name} />
                      <span className="composer-thumb-name">{img.name}</span>
                      <button
                        type="button"
                        className="composer-thumb-remove"
                        title="Remove image"
                        onClick={() =>
                          setPendingImages((prev) =>
                            prev.filter((item) => item.id !== img.id)
                          )
                        }
                      >
                        ✕
                      </button>
                    </div>
                  )
                )}
              </div>
            )}

            <textarea
              ref={textareaRef}
              rows={2}
              className="composer-textarea"
              placeholder="Message Claude Opus 5.5 (anthropic.claude-opus-5-5) or drop a picture / PDF file here..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="composer-actions">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="attach-pic-btn"
                  onClick={() => picInputRef.current?.click()}
                  title="Attach or drop a picture file"
                >
                  🖼️ Drop / Attach Pic
                </button>
                <button
                  type="button"
                  className="attach-pic-btn attach-pdf-btn"
                  onClick={() => pdfInputRef.current?.click()}
                  title="Upload or drop a PDF document"
                >
                  📄 Upload PDF
                </button>
                <span className="composer-hint">
                  Drag &amp; drop pics or PDFs anywhere in chat ·{" "}
                  <strong>Enter</strong> to send
                </span>
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  className="send-btn stop"
                  title="Stop generating"
                  onClick={handleStopGeneration}
                >
                  ■
                </button>
              ) : (
                <button
                  type="button"
                  className="send-btn"
                  title="Send message"
                  disabled={!input.trim() && pendingImages.length === 0}
                  onClick={() => sendPrompt(input)}
                >
                  ↑
                </button>
              )}
            </div>
          </div>
          <div className="composer-footer-note">
            AWS Bedrock Engine: <code>anthropic.claude-opus-5-5</code> (Profile:{" "}
            <code>us.anthropic.claude-opus-5-5</code>) · Agent: <code>build-epanet</code>
          </div>
        </footer>
      </main>

      {/* Right-Hand Separate Panel: Water System JSON Inputs, DEM Setup & build-epanet Controls */}
      <aside
        className={`epanet-right-panel ${rightPanelOpen ? "" : "collapsed"}`}
      >
        <div className="right-panel-header">
          <div className="right-panel-title-row">
            <div className="right-panel-title">
              <span>💧 Water System Studio</span>
              <button
                type="button"
                className="agent-badge inp-upload-btn"
                onClick={() => inpFileInputRef.current?.click()}
                disabled={isUploadingInp}
                title="Upload an EPANET .inp file to the AWS Amplify backend"
              >
                {isUploadingInp ? "⏳ Uploading..." : "inp Upload"}
              </button>
              <input
                ref={inpFileInputRef}
                type="file"
                accept=".inp,.txt"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleUploadInpFile(file);
                    e.target.value = "";
                  }
                }}
              />
            </div>
            <span style={{ fontSize: "0.73rem", color: "#64748b" }}>
              {loadedLayersCount}/7 layers
            </span>
          </div>
          {inpUploadedToBackendAt && (
            <div
              style={{
                fontSize: "0.72rem",
                color: "#047857",
                fontWeight: 600,
                marginTop: "2px",
              }}
            >
              ☁️ {inpUploadedToBackendAt}
            </div>
          )}
        </div>

        <div className="right-panel-body">
          {/* Step 1: Water System JSON Inputs */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">
                1. Water System JSON Inputs
              </span>
              {loadedLayersCount > 0 && (
                <button
                  type="button"
                  className="layer-upload-btn"
                  onClick={() => {
                    setWaterLayers({});
                    setAuditReport(null);
                    setBuildResult(null);
                    setFolderScanStatus(null);
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <span className="panel-card-subtitle">
              Set up your local drive folder for water system JSON files (
              <code>tank</code>, <code>pump</code>, <code>pipe</code>,{" "}
              <code>water demand</code>, <code>pressure zone</code>,{" "}
              <code>wtp</code>, <code>hydrant</code>):
            </span>

            <div className="panel-input-row">
              <input
                type="text"
                className="panel-text-input"
                placeholder="Enter local folder path (e.g. D:\AI\agent\epanet-auto\water-json)"
                value={waterJsonFolder}
                onChange={(e) => setWaterJsonFolder(e.target.value)}
              />
              <button
                type="button"
                className="layer-upload-btn"
                onClick={() => scanLocalWaterJsonFolder(waterJsonFolder)}
                title="Scan local drive folder path for .json and .geojson files"
              >
                Scan Folder
              </button>
              <button
                type="button"
                className="layer-upload-btn"
                onClick={() => folderJsonInputRef.current?.click()}
                title="Browse local folder for Water System JSON files"
              >
                📂 Browse
              </button>
              <input
                ref={folderJsonInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is supported by Chromium/Edge/Firefox for directory selection
                webkitdirectory=""
                directory=""
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) {
                    handleUploadWaterJsonFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.72rem",
                color: waterJsonFolder.trim() ? "#059669" : "#dc2626",
              }}
            >
              <span>
                {waterJsonFolder.trim()
                  ? `✓ JSON Folder: ${waterJsonFolder.trim()}${
                      loadedLayersCount > 0
                        ? ` (${loadedLayersCount} layer(s) loaded)`
                        : ""
                    }`
                  : "⚠ Please configure a local folder for Water System JSONs"}
              </span>
            </div>

            {folderScanStatus && (
              <div style={{ fontSize: "0.72rem", color: "#059669" }}>
                ✓ {folderScanStatus}
              </div>
            )}

            {uploadError && (
              <div style={{ fontSize: "0.74rem", color: "#dc2626" }}>
                ⚠ {uploadError}
              </div>
            )}

            {/* Available Data Window shown below the folder input */}
            <div className="available-data-window">
              <div className="available-data-window-header">
                <span>📂 Available Data in Folder</span>
                <span className="available-data-window-count">
                  {loadedLayersCount} file{loadedLayersCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="available-data-window-body">
                {loadedLayersCount === 0 ? (
                  <div className="available-data-empty">
                    No JSON data loaded yet. Enter a local drive folder path
                    above and click <strong>Scan Folder</strong> (or{" "}
                    <strong>📂 Browse</strong>) to display available water
                    system data here.
                  </div>
                ) : (
                  (Object.values(waterLayers) as UploadedLayerInfo[]).map(
                    (layer) => {
                      const isExpanded = selectedDataFileKey === layer.key;
                      return (
                        <div
                          key={layer.key}
                          className={`available-data-item ${
                            isExpanded ? "selected" : ""
                          }`}
                          onClick={() =>
                            setSelectedDataFileKey((prev) =>
                              prev === layer.key ? null : layer.key
                            )
                          }
                          title="Click to inspect JSON features in this file"
                        >
                          <div className="available-data-item-top">
                            <span className="available-data-filename">
                              <span>📄</span>
                              <span>{layer.fileName}</span>
                            </span>
                            <span className="available-data-type-badge">
                              {layer.label.replace(/\s*\(.*\)$/, "")}
                            </span>
                          </div>
                          <div className="available-data-meta">
                            <span>
                              {layer.featureCount} feature
                              {layer.featureCount === 1 ? "" : "s"} (
                              {layer.geometryTypes.join(", ") || "GeoJSON"})
                            </span>
                            <span>ID: {layer.standardizedIdRange}</span>
                          </div>
                          {isExpanded && (
                            <pre className="available-data-preview">
                              {layer.rawText.slice(0, 1200)}
                            </pre>
                          )}
                        </div>
                      );
                    }
                  )
                )}
              </div>
            </div>
          </div>

          {/* Step 2: DEM Download */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">2. DEM Data</span>
              <button
                type="button"
                className="layer-upload-btn"
                onClick={handleDemDownloadClick}
                disabled={isDownloadingDem || isSearchingDemCoverage}
              >
                {isSearchingDemCoverage
                  ? "⏳ Mapping Coverage..."
                  : isDownloadingDem
                  ? `⏳ Downloading (${demDownloadProgress?.percent ?? 0}%)...`
                  : "⬇ Download DEM"}
              </button>
            </div>

            {demDownloadProgress && (
              <div
                className={`dem-progress-container ${
                  demDownloadProgress.percent >= 100 ? "completed" : "active"
                }`}
              >
                <div className="dem-progress-header">
                  <span className="dem-progress-stage">
                    {demDownloadProgress.percent >= 100 ? "✅ " : "⏳ "}
                    {demDownloadProgress.stage}
                  </span>
                  <span className="dem-progress-pct">
                    {demDownloadProgress.percent}%
                  </span>
                </div>
                <div className="dem-progress-track">
                  <div
                    className={`dem-progress-fill ${
                      demDownloadProgress.percent >= 100 ? "completed" : "active"
                    }`}
                    style={{ width: `${demDownloadProgress.percent}%` }}
                  />
                </div>
                <div className="dem-progress-detail">
                  {demDownloadProgress.detail}
                </div>
              </div>
            )}

            {gisCoverage && (
              <div className="dem-coverage-section">
                <div className="dem-coverage-header">
                  <span className="dem-coverage-title">
                    🗺️ GIS Data Coverage ({gisCoverage.sourceFileName})
                  </span>
                  <span className="dem-coverage-badge">
                    {gisCoverage.areaSqMiles} sq mi ({gisCoverage.areaAcres}{" "}
                    acres)
                  </span>
                </div>

                <div
                  ref={demMapContainerRef}
                  className="dem-leaflet-map"
                  aria-label="GIS Data Coverage Map"
                />

                <div className="dem-coverage-stats">
                  <div>
                    <strong>File:</strong> {gisCoverage.sourceFileName} (
                    {gisCoverage.featureCount.toLocaleString()} features) |{" "}
                    <strong>CRS:</strong> {gisCoverage.sourceCrs} &rarr;
                    EPSG:4326
                  </div>
                  <div>
                    <strong>Area:</strong> {gisCoverage.areaSqMiles} sq mi (
                    {gisCoverage.areaAcres} acres) | <strong>Vertices:</strong>{" "}
                    {gisCoverage.originalVertexCount} (simplified to{" "}
                    {gisCoverage.simplifiedVertexCount})
                  </div>
                  <div>
                    <strong>WGS84 BBox:</strong> [
                    {gisCoverage.bbox4326.map((n) => n.toFixed(4)).join(", ")}]
                  </div>
                </div>

                <div className="dem-coverage-legend">
                  <span className="dem-legend-item">
                    <span
                      className="dem-legend-swatch"
                      style={{ background: "#38bdf8", borderColor: "#0284c7" }}
                    />
                    AOI Coverage
                  </span>
                  {gisCoverage.layerOverlays.map((ov) => (
                    <span key={ov.key} className="dem-legend-item">
                      <span
                        className="dem-legend-swatch"
                        style={{ background: ov.color, borderColor: ov.color }}
                      />
                      {ov.label} ({ov.featureCount})
                    </span>
                  ))}
                  {demIntersectingTiles.length > 0 && (
                    <span className="dem-legend-item">
                      <span
                        className="dem-legend-swatch"
                        style={{
                          background: "rgba(16, 185, 129, 0.35)",
                          borderColor: "#10b981",
                        }}
                      />
                      DEM Tiles ({demIntersectingTiles.length})
                    </span>
                  )}
                </div>
              </div>
            )}

            {availableDemDatasets.length > 0 && (
              <div className="dem-options-section">
                <div className="dem-options-header">
                  <span className="dem-options-title">
                    📋 Available DEM &amp; LiDAR Options (
                    {availableDemDatasets.length})
                  </span>
                  <span className="dem-options-prompt">
                    Choose one to download:
                  </span>
                </div>

                <div className="dem-options-list">
                  {availableDemDatasets.map((ds) => {
                    const isSelected = selectedDemMissionId === ds.missionId;
                    const isDemType = ds.dataType.toUpperCase() === "DEM";
                    return (
                      <div
                        key={ds.missionId}
                        className={`dem-option-card ${
                          isSelected ? "selected" : ""
                        }`}
                        onClick={() => setSelectedDemMissionId(ds.missionId)}
                      >
                        <div className="dem-option-top">
                          <label className="dem-option-radio-label">
                            <input
                              type="radio"
                              name="demDatasetChoice"
                              checked={isSelected}
                              onChange={() =>
                                setSelectedDemMissionId(ds.missionId)
                              }
                            />
                            <span
                              className={`dem-datatype-badge ${
                                isDemType ? "dem" : "lidar"
                              }`}
                            >
                              {ds.dataType.toUpperCase()}
                            </span>
                            <span className="dem-option-title">{ds.title}</span>
                          </label>
                          {ds.recommended && (
                            <span className="dem-recommended-pill">
                              Recommended
                            </span>
                          )}
                        </div>

                        <div className="dem-option-meta">
                          <span>
                            Mission ID: <strong>#{ds.missionId}</strong>
                          </span>
                          <span>·</span>
                          <span>
                            Year: <strong>{ds.year}</strong>
                          </span>
                          <span>·</span>
                          <span>
                            VDatum: <strong>{ds.verticalDatum}</strong>
                          </span>
                          <span>·</span>
                          <span className="dem-source-tag">
                            {ds.bulkDownloadUrl
                              ? "S3 Bulk Tiles"
                              : "NOAA DAV"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="dem-confirm-download-btn"
                  onClick={() => void handleConfirmDemDatasetDownload()}
                  disabled={isDownloadingDem || !selectedDemMissionId}
                >
                  {isDownloadingDem
                    ? `⏳ Downloading Selected DEM (${
                        demDownloadProgress?.percent ?? 0
                      }%)...`
                    : `⬇ Download Selected DEM Data${
                        selectedDemMissionId
                          ? ` (Mission #${selectedDemMissionId})`
                          : ""
                      }`}
                </button>
              </div>
            )}

            {demDownloadError && (
              <div style={{ fontSize: "0.73rem", color: "#dc2626" }}>
                ⚠ DEM Download Error: {demDownloadError}
              </div>
            )}
          </div>

          {/* Step 3: Model CRS & Name Config */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">
                3. Model Name &amp; State Plane CRS
              </span>
            </div>
            <div className="panel-input-row">
              <input
                type="text"
                className="panel-text-input"
                placeholder="Model name"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
              <input
                type="text"
                className="panel-text-input"
                style={{ maxWidth: "115px" }}
                placeholder="EPSG:2264"
                value={targetCrs}
                onChange={(e) => setTargetCrs(e.target.value)}
              />
            </div>
          </div>

          {/* Step 4: Model Building Process & Steps */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">
                4. Model Building Progress &amp; Steps
              </span>
              <button
                type="button"
                className="layer-upload-btn"
                onClick={handleRunBuild}
                disabled={isBuildingModel}
                title="Run 6-step build-epanet model building process"
              >
                {isBuildingModel
                  ? `⏳ Building (${buildProgressPercent}%)...`
                  : "⚡ Run Build"}
              </button>
            </div>

            <div
              className={`dem-progress-container ${
                buildProgressPercent >= 100
                  ? "completed"
                  : isBuildingModel
                  ? "active"
                  : ""
              }`}
            >
              <div className="dem-progress-header">
                <span className="dem-progress-stage">
                  {buildProgressPercent >= 100
                    ? "✅ "
                    : isBuildingModel
                    ? "⏳ "
                    : "⚙️ "}
                  {buildStageText}
                </span>
                <span className="dem-progress-pct">{buildProgressPercent}%</span>
              </div>
              <div className="dem-progress-track">
                <div
                  className={`dem-progress-fill ${
                    buildProgressPercent >= 100 ? "completed" : "active"
                  }`}
                  style={{ width: `${buildProgressPercent}%` }}
                />
              </div>
              <div className="dem-progress-detail">{buildDetailText}</div>
            </div>

            <div className="build-steps-list">
              {buildSteps.map((step) => (
                <div
                  key={step.id}
                  className={`build-step-item ${step.status}`}
                >
                  <div className="build-step-icon">
                    {step.status === "completed"
                      ? "✅"
                      : step.status === "running"
                      ? "⏳"
                      : step.status === "error"
                      ? "❌"
                      : step.stepNumber}
                  </div>
                  <div className="build-step-content">
                    <div className="build-step-title">
                      Step {step.stepNumber}: {step.title}
                    </div>
                    <div className="build-step-detail">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 4: Audit Report Card */}
          {auditReport && (
            <div className="panel-card">
              <div className="panel-card-header">
                <span className="panel-card-title">
                  🔍 Audit Checklist ({auditReport.overallStatus})
                </span>
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
                  {auditReport.missingComponents.length} missing
                </span>
              </div>
              <div className="audit-list">
                {auditReport.items.map((item) => (
                  <div key={item.id} className={`audit-item ${item.status}`}>
                    <div style={{ fontWeight: 600 }}>
                      {item.status === "pass"
                        ? "✅ "
                        : item.status === "warning"
                        ? "⚠️ "
                        : "❌ "}
                      {item.component}
                    </div>
                    <div style={{ color: "#334155" }}>{item.summary}</div>
                    {item.recommendation && (
                      <div style={{ color: "#64748b", marginTop: "2px" }}>
                        💡 {item.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Built EPANET .inp Output Card */}
          {buildResult && (
            <div className="panel-card">
              <div className="panel-card-header">
                <span className="panel-card-title">
                  ⚡ Built Model: {buildResult.inpFileName}
                </span>
                <button
                  type="button"
                  className="epanet-btn build-btn"
                  style={{ padding: "4px 10px", fontSize: "0.74rem" }}
                  onClick={handleDownloadInpFile}
                >
                  ⬇ Download .inp
                </button>
              </div>
              {inpModifiedByBedrockAt && (
                <div
                  style={{
                    fontSize: "0.73rem",
                    color: "#059669",
                    fontWeight: 600,
                  }}
                >
                  ✨ Modified by AWS Bedrock in Amplify Backend (
                  {inpModifiedByBedrockAt})
                </div>
              )}
              <span className="panel-card-subtitle">
                Junctions: <strong>{buildResult.stats.junctions}</strong> · Pipes:{" "}
                <strong>{buildResult.stats.pipes}</strong> (OPEN:{" "}
                {buildResult.stats.openPipes}, PZ Closed:{" "}
                {buildResult.stats.closedBoundaryPipes}) · Tanks:{" "}
                <strong>{buildResult.stats.tanks}</strong> · Pumps:{" "}
                <strong>{buildResult.stats.pumps}</strong> · Demand:{" "}
                <strong>{buildResult.stats.totalDemandGpm} GPM</strong>
              </span>
              <div className="inp-preview-box">{buildResult.inpContent}</div>
            </div>
          )}

          {/* Step 6: AWS Amplify Storage (.inp Files) Card */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">
                ☁️ AWS Amplify Storage (.inp Files)
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="available-data-window-count">
                  {amplifyStoredInpFiles.length} file
                  {amplifyStoredInpFiles.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="layer-upload-btn"
                  onClick={() => void refreshAmplifyStoredInpFiles()}
                  disabled={isLoadingStoredInpFiles}
                  title="Refresh .inp files from AWS Amplify Storage"
                >
                  {isLoadingStoredInpFiles ? "⏳..." : "↻ Refresh"}
                </button>
              </div>
            </div>

            <span className="panel-card-subtitle">
              All EPANET <code>.inp</code> files stored in AWS Amplify Storage (
              <code>inp-files/</code>). Click <strong>⬇ Download .inp</strong> to
              save any model directly to your local drive.
            </span>

            <div className="available-data-window">
              <div className="available-data-window-header">
                <span>🗄️ Stored .inp Files in AWS Amplify</span>
                <span className="available-data-window-count">
                  inp-files/*
                </span>
              </div>
              <div className="available-data-window-body">
                {amplifyStoredInpFiles.length === 0 ? (
                  <div className="available-data-empty">
                    No <code>.inp</code> files in AWS Amplify Storage yet. Click{" "}
                    <strong>inp Upload</strong> at the top or{" "}
                    <strong>⚡ Run Build</strong> above to store an{" "}
                    <code>.inp</code> model in AWS Amplify.
                  </div>
                ) : (
                  amplifyStoredInpFiles.map((item) => {
                    const isActive =
                      buildResult?.inpFileName.toLowerCase() ===
                      item.fileName.toLowerCase();
                    const isDownloading =
                      downloadingStoredFileName === item.fileName;
                    return (
                      <div
                        key={item.id}
                        className={`available-data-item ${
                          isActive ? "selected" : ""
                        }`}
                        onClick={() => void handleSelectStoredInpFile(item)}
                        title="Click to load this .inp file into the Built Model viewer"
                      >
                        <div className="available-data-item-top">
                          <span className="available-data-filename">
                            <span>📄</span>
                            <span>{item.fileName}</span>
                            {isActive && (
                              <span className="available-data-type-badge">
                                Active
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            className="epanet-btn build-btn"
                            style={{
                              padding: "3px 9px",
                              fontSize: "0.72rem",
                              flexShrink: 0,
                            }}
                            disabled={isDownloading}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownloadStoredInpFile(item);
                            }}
                            title={`Download ${item.fileName} from AWS Amplify Storage to your local drive`}
                          >
                            {isDownloading
                              ? "⏳ Saving..."
                              : "⬇ Download .inp"}
                          </button>
                        </div>
                        <div className="available-data-meta">
                          <span>
                            {(item.sizeBytes / 1024).toFixed(1)} KB ·{" "}
                            {item.source}
                          </span>
                          <span>
                            {new Date(item.updatedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default App;


