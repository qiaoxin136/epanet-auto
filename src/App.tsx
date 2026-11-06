import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  BEDROCK_ENGINE_CONFIG,
  ChatImageAttachment,
  ChatMessage,
  ConversationThread,
  ExecutionMode,
  queryBedrockGpt6Sol,
} from "./bedrockEngine";
import {
  AuditReport,
  BuildEpanetResult,
  DEM_DOWNLOAD_URL,
  DemDownloadProgress,
  UploadedLayerInfo,
  WaterLayerKey,
  auditWaterSystem,
  buildEpanetModel,
  createSampleWaterSystemLayers,
  downloadDemForWaterSystem,
  parseWaterJsonFile,
} from "./epanetBuilder";
import { extractPdfContent } from "./pdfExtractor";

const STORAGE_KEY = "epanet_auto_gpt6_sol_threads_v1";

interface BuildStepItem {
  id: string;
  stepNumber: number;
  title: string;
  detail: string;
  status: "pending" | "running" | "completed";
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
      detail: "Extract ground elevations (ft) for junctions, storage tanks, and reservoirs",
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
    "You are GPT-6 Sol (openai.gpt-6-sol) paired with the build-epanet hydraulic modeling agent on AWS Bedrock."
  );
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Right-hand Water System & build-epanet Panel state
  const [modelName, setModelName] = useState<string>("water_distribution_model");
  const [targetCrs, setTargetCrs] = useState<string>("EPSG:2264");
  const [demFolder, setDemFolder] = useState<string>("D:\\AI\\agent\\epanet-auto\\DEM");
  const [demTileNames, setDemTileNames] = useState<string[]>([]);
  const [isDownloadingDem, setIsDownloadingDem] = useState<boolean>(false);
  const [demDownloadProgress, setDemDownloadProgress] =
    useState<DemDownloadProgress | null>(null);
  const [demDownloadError, setDemDownloadError] = useState<string | null>(null);
  const [waterJsonFolder, setWaterJsonFolder] = useState<string>(
    "D:\\AI\\agent\\epanet-auto\\water-json"
  );
  const [waterLayers, setWaterLayers] = useState<
    Partial<Record<WaterLayerKey, UploadedLayerInfo>>
  >({});
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [buildResult, setBuildResult] = useState<BuildEpanetResult | null>(null);
  const [isBuildingModel, setIsBuildingModel] = useState<boolean>(false);
  const [buildProgressPercent, setBuildProgressPercent] = useState<number>(0);
  const [buildStageText, setBuildStageText] = useState<string>(
    "Ready to build EPANET .inp model"
  );
  const [buildDetailText, setBuildDetailText] = useState<string>(
    "Click ⚡ Build to run the 6-step build-epanet hydraulic modeling pipeline."
  );
  const [buildSteps, setBuildSteps] = useState<BuildStepItem[]>(() =>
    createInitialBuildSteps("EPSG:2264", "water_distribution_model")
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
  const demFileInputRef = useRef<HTMLInputElement | null>(null);

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
        try {
          const info = parseWaterJsonFile(file.name, file.content);
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

  function handleLoadSampleLayers() {
    setUploadError(null);
    const samples = createSampleWaterSystemLayers();
    setWaterLayers(samples);
    const nextJsonFolder =
      waterJsonFolder.trim() || "D:\\AI\\agent\\epanet-auto\\water-json";
    if (!waterJsonFolder.trim()) {
      setWaterJsonFolder(nextJsonFolder);
    }
    if (!demFolder.trim()) {
      setDemFolder("D:\\AI\\agent\\epanet-auto\\DEM");
    }
    setFolderScanStatus(`Loaded 7 sample layers from ${nextJsonFolder}`);
    setDemTileNames(["USGS_1m_NC_Sanford_Tile1.tif", "USGS_1m_NC_Sanford_Tile2.tif"]);
    const report = auditWaterSystem(
      samples,
      demFolder.trim() || "D:\\AI\\agent\\epanet-auto\\DEM",
      ["USGS_1m_NC_Sanford_Tile1.tif", "USGS_1m_NC_Sanford_Tile2.tif"],
      targetCrs,
      nextJsonFolder
    );
    setAuditReport(report);
  }

  async function handleDemDownloadClick() {
    if (isDownloadingDem) return;

    let targetDemDir = demFolder.trim();
    if (!targetDemDir) {
      targetDemDir = "D:\\AI\\agent\\epanet-auto\\DEM";
      setDemFolder(targetDemDir);
    }

    setIsDownloadingDem(true);
    setDemDownloadError(null);
    setDemDownloadProgress({
      percent: 5,
      stage: "Initializing DEM Download",
      detail: `Preparing DEM download for ${targetDemDir}...`,
    });

    try {
      let activeLayers = waterLayers;
      if (Object.keys(activeLayers).length === 0 && waterJsonFolder.trim()) {
        setDemDownloadProgress({
          percent: 8,
          stage: "Scanning Water System JSONs",
          detail: `Reading water system AOI from ${waterJsonFolder.trim()}...`,
        });
        const scanned = await scanLocalWaterJsonFolder(waterJsonFolder);
        if (Object.keys(scanned).length > 0) {
          activeLayers = { ...activeLayers, ...scanned };
        }
      }

      const result = await downloadDemForWaterSystem({
        layers: activeLayers,
        demFolder: targetDemDir,
        targetCrs,
        onProgress: (prog) => {
          setDemDownloadProgress(prog);
        },
      });

      setDemTileNames((prev) =>
        Array.from(new Set([...prev, ...result.tifFiles]))
      );

      appendAgentConversationPair(
        `Download DEM GeoTIFF tiles from ${DEM_DOWNLOAD_URL} into ${targetDemDir}`,
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
      demFolder,
      demTileNames,
      targetCrs,
      waterJsonFolder
    );
    setAuditReport(report);
    appendAgentConversationPair(
      "Audit water system JSON files and DEM folder for missing components.",
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
        demFolder,
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

      // Compute full build result so we can report exact stats across steps 2-6
      const built = buildEpanetModel(
        modelName,
        targetCrs,
        demFolder,
        activeLayers,
        waterJsonFolder
      );

      // Advance to Step 3: DEM Sampling
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 1) {
            return {
              ...s,
              status: "completed",
              detail: `CRS ${built.crs} (ftUS) · Pipes ${built.facilityIdRanges.Pipes} · Nodes ${built.facilityIdRanges.Junctions}`,
            };
          }
          if (idx === 2) return { ...s, status: "running" };
          return s;
        })
      );
      setBuildProgressPercent(48);
      setBuildStageText("Step 3/6: Sampling DEM GeoTIFF Elevations...");
      setBuildDetailText(
        `Sampling ground elevations from ${
          demFolder.trim() || "DEM folder"
        } for ${built.stats.demSampledNodes} nodes...`
      );
      await pause(240);

      // Advance to Step 4: Topology & Auto-Connect
      setBuildSteps((prev) =>
        prev.map((s, idx) => {
          if (idx === 2) {
            return {
              ...s,
              status: "completed",
              detail: `Sampled elevations for ${built.stats.demSampledNodes} junctions & ${built.stats.tanks} tank(s)`,
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

      appendAgentConversationPair(
        `Run build-epanet agent to build ${built.inpFileName} (CRS ${targetCrs})`,
        built.markdownSummary
      );
    } finally {
      setIsBuildingModel(false);
    }
  }

  function handleDownloadInpFile() {
    if (!buildResult) return;
    const blob = new Blob([buildResult.inpContent], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildResult.inpFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      lowerPrompt.includes("build") &&
      lowerPrompt.includes(".inp")
    ) {
      setInput("");
      handleRunBuild();
      return;
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
              <span className="brand-dot">G6</span>
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
              🖼️ / 📄 Drop picture or PDF file here to attach to GPT-6 Sol
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
              <div className="welcome-logo">G6</div>
              <h1 className="welcome-title">What can I help with?</h1>
              <p className="welcome-subtitle">
                Conversational AI powered by <strong>OpenAI GPT-6 Sol</strong> (
                <code>openai.gpt-6-sol</code>) + <strong>build-epanet</strong> agent.
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
                    <div className="assistant-avatar">G6</div>
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
              placeholder="Message GPT-6 Sol (openai.gpt-6-sol) or drop a picture / PDF file here..."
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
            AWS Bedrock Engine: <code>openai.gpt-6-sol</code> (Profile:{" "}
            <code>us.openai.gpt-6-sol</code>) · Agent: <code>build-epanet</code>
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
              <span className="agent-badge">build-epanet</span>
            </div>
            <span style={{ fontSize: "0.73rem", color: "#64748b" }}>
              {loadedLayersCount}/7 layers
            </span>
          </div>

          {/* Primary Action Buttons: DEM Download, Audit, Build */}
          <div className="right-action-bar">
            <button
              type="button"
              className="epanet-btn dem-btn"
              onClick={handleDemDownloadClick}
              disabled={isDownloadingDem}
              title={`Download DEM tiles from ${DEM_DOWNLOAD_URL}`}
            >
              {isDownloadingDem
                ? `⏳ ${demDownloadProgress?.percent ?? 0}%`
                : "⬇ DEM Download"}
            </button>
            <button
              type="button"
              className="epanet-btn audit-btn"
              onClick={handleRunAudit}
              title="Audit water system JSON layers and DEM folder for missing components"
            >
              🔍 Audit
            </button>
            <button
              type="button"
              className="epanet-btn build-btn"
              onClick={handleRunBuild}
              disabled={isBuildingModel}
              title="Run build-epanet agent to generate EPANET .inp model"
            >
              {isBuildingModel
                ? `⏳ ${buildProgressPercent}%`
                : "⚡ Build"}
            </button>
          </div>
        </div>

        <div className="right-panel-body">
          {/* Step 1: Water System JSON Inputs */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">
                1. Water System JSON Inputs
              </span>
              <div style={{ display: "flex", gap: "5px" }}>
                <button
                  type="button"
                  className="layer-upload-btn"
                  onClick={handleLoadSampleLayers}
                  title="Load sample Tank, Pump, Pipe, Water Demand, Pressure Zone, WTP, and Hydrant JSON files"
                >
                  Load Sample JSONs
                </button>
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

          {/* Step 2: DEM Data Folder Setup & Download */}
          <div className="panel-card">
            <div className="panel-card-header">
              <span className="panel-card-title">2. DEM Data Folder Setup</span>
              <a
                href={DEM_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "0.73rem", color: "#0284c7" }}
              >
                Open DEM Portal ↗
              </a>
            </div>
            <span className="panel-card-subtitle">
              Set up your destination folder for DEM GeoTIFF (<code>.tif</code>)
              elevation data before running <code>build-epanet</code>:
            </span>
            <div className="panel-input-row">
              <input
                type="text"
                className="panel-text-input"
                placeholder="Enter DEM folder path (e.g. D:\AI\agent\epanet-auto\DEM)"
                value={demFolder}
                onChange={(e) => setDemFolder(e.target.value)}
              />
              <button
                type="button"
                className="layer-upload-btn"
                onClick={() => demFileInputRef.current?.click()}
                title="Select local .tif DEM files"
              >
                + .tif
              </button>
              <input
                ref={demFileInputRef}
                type="file"
                accept=".tif,.tiff"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) {
                    const names = Array.from(e.target.files).map((f) => f.name);
                    setDemTileNames(names);
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
                color: demFolder.trim() ? "#059669" : "#dc2626",
              }}
            >
              <span>
                {demFolder.trim()
                  ? `✓ Folder: ${demFolder.trim()}${
                      demTileNames.length > 0
                        ? ` (${demTileNames.length} .tif files)`
                        : ""
                    }`
                  : "⚠ Please configure a DEM destination folder"}
              </span>
              <button
                type="button"
                className="layer-upload-btn"
                onClick={handleDemDownloadClick}
                disabled={isDownloadingDem}
              >
                {isDownloadingDem
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

            {demDownloadError && (
              <div style={{ fontSize: "0.73rem", color: "#dc2626" }}>
                ⚠ DEM Download Error: {demDownloadError}
              </div>
            )}

            {demTileNames.length > 0 && (
              <div className="dem-files-badges">
                {demTileNames.map((name) => (
                  <span key={name} className="dem-file-chip">
                    🗺️ {name}
                  </span>
                ))}
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
        </div>
      </aside>
    </div>
  );
}

export default App;


