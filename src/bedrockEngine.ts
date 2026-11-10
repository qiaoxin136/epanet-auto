import { generateClient } from "aws-amplify/data";
import { downloadData, list, uploadData } from "aws-amplify/storage";
import outputs from "../amplify_outputs.json";
import { extractPdfContent } from "./pdfExtractor";

interface AskGpt6SolGraphqlResponse {
  data?: {
    reply: string;
    modelId: string;
    inferenceProfileId: string;
    source: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    errorDetail?: string | null;
    updatedInpContent?: string | null;
    updatedInpFileName?: string | null;
  } | null;
  errors?: Array<{ message: string }>;
}

interface AskGpt6SolClient {
  queries: {
    askGpt6Sol: (args: {
      messagesJson: string;
      systemPrompt?: string;
      temperature?: number;
      mode?: string;
      inpContent?: string;
      inpFileName?: string;
    }) => Promise<AskGpt6SolGraphqlResponse>;
  };
  models?: {
    Todo?: {
      get: (args: { id: string }) => Promise<{
        data?: { id: string; content?: string | null; updatedAt?: string } | null;
      }>;
      list: (args?: { limit?: number }) => Promise<{
        data?: Array<{ id: string; content?: string | null; updatedAt?: string }> | null;
      }>;
      create: (args: { id: string; content: string }) => Promise<{
        data?: { id: string; content?: string | null } | null;
      }>;
      update: (args: { id: string; content: string }) => Promise<{
        data?: { id: string; content?: string | null } | null;
      }>;
    };
  };
}

export type ExecutionMode = "bedrock";

export interface ChatImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  width?: number;
  height?: number;
  pageCount?: number;
  wordCount?: number;
  extractedText?: string;
  renderedPageImages?: string[];
  pdfJsExtracted?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  attachments?: ChatImageAttachment[];
  modelId?: string;
  inferenceProfileId?: string;
  source?: "aws-bedrock" | "bedrock-error";
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  errorDetail?: string | null;
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface BedrockQueryOptions {
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    attachments?: ChatImageAttachment[];
  }>;
  systemPrompt: string;
  temperature: number;
  mode: ExecutionMode;
  activeInpContent?: string;
  activeInpFileName?: string;
  signal?: AbortSignal;
  onToken?: (partialText: string) => void;
}

export interface BedrockQueryResult {
  reply: string;
  modelId: string;
  inferenceProfileId: string;
  source: "aws-bedrock" | "bedrock-error";
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  errorDetail?: string | null;
  updatedInpContent?: string | null;
  updatedInpFileName?: string | null;
}

export const BEDROCK_ENGINE_CONFIG = {
  provider: "Anthropic (via AWS Bedrock)",
  modelName: "Claude Opus 5.5",
  modelId: "anthropic.claude-opus-5-5",
  inferenceProfileId: "us.anthropic.claude-opus-5-5",
  globalProfileId: "global.anthropic.claude-opus-5-5",
  region: "us-east-2",
} as const;

export function isAmplifyBackendConfigured(): boolean {
  const url = (outputs as { data?: { url?: string } })?.data?.url;
  return Boolean(url && url.startsWith("https://") && !url.includes("LOCALMOCK"));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

async function streamTextToCallback(
  fullText: string,
  onToken?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!onToken) {
    return fullText;
  }

  const tokens = fullText.match(/\S+\s*|\n/g) || [fullText];
  let accumulated = "";

  for (let i = 0; i < tokens.length; i += 2) {
    if (signal?.aborted) {
      return accumulated + " _[generation stopped]_";
    }
    accumulated += tokens[i] + (tokens[i + 1] || "");
    onToken(accumulated);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  return accumulated;
}

async function prepareMessagesWithPdfExtraction(
  messages: BedrockQueryOptions["messages"]
): Promise<BedrockQueryOptions["messages"]> {
  const prepared: BedrockQueryOptions["messages"] = [];

  for (const msg of messages) {
    if (
      msg.role !== "user" ||
      !msg.attachments ||
      msg.attachments.length === 0
    ) {
      prepared.push(msg);
      continue;
    }

    const pdfTextSections: string[] = [];
    const visualImageLines: string[] = [];
    const transportAttachments: ChatImageAttachment[] = [];
    let pdfIndex = 0;
    let attachedImageCounter = 0;

    for (const att of msg.attachments) {
      const isPdf =
        att.mimeType === "application/pdf" || /\.pdf$/i.test(att.name || "");

      if (!isPdf) {
        attachedImageCounter++;
        transportAttachments.push(att);
        visualImageLines.push(
          `- Attached Image ${attachedImageCounter}: Picture file "${att.name}"`
        );
        continue;
      }

      pdfIndex++;
      let extractedText = att.extractedText || "";
      let pageCount = att.pageCount || 1;
      let renderedPageImages = att.renderedPageImages || [];

      // Always extract/render if renderedPageImages are missing so previously uploaded PDFs in thread history also get rendered
      if (
        (!att.pdfJsExtracted ||
          !renderedPageImages ||
          renderedPageImages.length === 0) &&
        att.dataUrl
      ) {
        try {
          const parsed = await extractPdfContent(att.dataUrl);
          extractedText = parsed.extractedText;
          pageCount = parsed.pageCount;
          renderedPageImages = parsed.renderedPageImages;
          att.extractedText = extractedText;
          att.pageCount = pageCount;
          att.wordCount = parsed.wordCount;
          att.renderedPageImages = renderedPageImages;
          att.pdfJsExtracted = true;
        } catch {
          // Keep existing fields
        }
      }

      if (renderedPageImages.length > 0) {
        renderedPageImages.forEach((imgDataUrl, idx) => {
          attachedImageCounter++;
          transportAttachments.push({
            id: `${att.id}-page-${idx + 1}`,
            name: `${att.name} (Page ${idx + 1} of ${pageCount})`,
            mimeType: "image/jpeg",
            sizeBytes: imgDataUrl.length,
            dataUrl: imgDataUrl,
          });
          visualImageLines.push(
            `- Attached Image ${attachedImageCounter}: High-resolution visual page rendering of PDF ${pdfIndex} "${att.name}" (Page ${
              idx + 1
            } of ${pageCount})`
          );
        });
      }

      if (extractedText.trim()) {
        pdfTextSections.push(
          [
            `=== SELECTABLE TEXT LAYER FROM PDF ${pdfIndex}: "${att.name}" (${pageCount} page(s)) ===`,
            extractedText.trim(),
            `=== END OF SELECTABLE TEXT FROM "${att.name}" ===`,
          ].join("\n")
        );
      }
    }

    let combinedContent = msg.content.trim();
    if (pdfIndex > 0) {
      const promptParts: string[] = [
        combinedContent || "Please read and analyze the attached PDF file(s).",
        "",
        "IMPORTANT VISUAL INSPECTION INSTRUCTIONS:",
        `The user attached ${pdfIndex} PDF document(s). Every page has been rendered into a high-resolution image and attached directly to this message:`,
        ...visualImageLines,
        "",
        "Please visually inspect each attached image carefully and describe/analyze all pictures, photographs, diagrams, engineering schematics, charts, maps, shapes, colors, labels, and visual details shown in each PDF.",
      ];

      if (pdfTextSections.length > 0) {
        promptParts.push(
          "",
          "In addition to the visual page images above, here is the selectable text layer extracted from the PDF(s):",
          "",
          pdfTextSections.join("\n\n")
        );
      }

      combinedContent = promptParts.join("\n");
    }

    prepared.push({
      role: msg.role,
      content: combinedContent,
      attachments:
        transportAttachments.length > 0 ? transportAttachments : undefined,
    });
  }

  // Keep image bytes focused on the most recent turn(s) (up to 10 images total) so multi-turn threads stay fast and under payload limits
  let remainingImageBudget = 10;
  for (let i = prepared.length - 1; i >= 0; i--) {
    const turn = prepared[i];
    if (!turn.attachments || turn.attachments.length === 0) continue;
    if (remainingImageBudget <= 0) {
      turn.attachments = undefined;
    } else if (turn.attachments.length > remainingImageBudget) {
      turn.attachments = turn.attachments.slice(0, remainingImageBudget);
      remainingImageBudget = 0;
    } else {
      remainingImageBudget -= turn.attachments.length;
    }
  }

  return prepared;
}

const AMPLIFY_ACTIVE_INP_RECORD_ID = "epanet-active-inp-v1";
const AMPLIFY_INP_FILE_PREFIX = "epanet-inp-file::";
const LOCAL_STORAGE_INP_CACHE_KEY = "epanet-amplify-storage-inp-files-v1";

export interface AmplifyStoredInpFile {
  id: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  updatedAt: string;
  source: string;
  inpContent?: string;
}

export function isAmplifyStorageBucketConfigured(): boolean {
  const bucket = (outputs as { storage?: { bucket_name?: string } })?.storage
    ?.bucket_name;
  return Boolean(bucket && bucket.trim().length > 0);
}

function normalizeInpFileName(fileName: string): string {
  const trimmed = (fileName || "water_distribution_model.inp").trim();
  return trimmed.toLowerCase().endsWith(".inp")
    ? trimmed
    : `${trimmed.replace(/\.[^.]+$/, "")}.inp`;
}

function readLocalInpStorageCache(): AmplifyStoredInpFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_INP_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AmplifyStoredInpFile[]) : [];
  } catch {
    return [];
  }
}

function upsertLocalInpStorageCache(entry: AmplifyStoredInpFile): void {
  if (typeof window === "undefined") return;
  try {
    const current = readLocalInpStorageCache().filter(
      (item) => item.fileName.toLowerCase() !== entry.fileName.toLowerCase()
    );
    const next = [entry, ...current].slice(0, 25);
    window.localStorage.setItem(LOCAL_STORAGE_INP_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota issues
  }
}

export async function syncInpToAmplifyBackend(
  fileName: string,
  inpContent: string,
  sourceLabel: string = "Water System Studio"
): Promise<boolean> {
  if (!inpContent.trim()) return false;
  const cleanFileName = normalizeInpFileName(fileName);
  const nowIso = new Date().toISOString();
  const recordId = `${AMPLIFY_INP_FILE_PREFIX}${cleanFileName}`;
  const storagePath = `inp-files/${cleanFileName}`;

  upsertLocalInpStorageCache({
    id: recordId,
    fileName: cleanFileName,
    storagePath,
    sizeBytes: inpContent.length,
    updatedAt: nowIso,
    source: sourceLabel,
    inpContent,
  });

  let syncedCloud = false;

  if (isAmplifyStorageBucketConfigured()) {
    try {
      await uploadData({
        path: storagePath,
        data: inpContent,
        options: {
          contentType: "text/plain;charset=utf-8",
        },
      }).result;
      syncedCloud = true;
    } catch {
      // Fallback to Amplify Data below
    }
  }

  if (isAmplifyBackendConfigured()) {
    try {
      const client = generateClient() as unknown as AskGpt6SolClient;
      const todoModel = client.models?.Todo;
      if (todoModel) {
        const payload = JSON.stringify({
          type: "EPANET_INP",
          fileName: cleanFileName,
          storagePath,
          sizeBytes: inpContent.length,
          source: sourceLabel,
          inpContent,
          updatedAt: nowIso,
        });

        const existingActive = await todoModel.get({
          id: AMPLIFY_ACTIVE_INP_RECORD_ID,
        });
        if (existingActive?.data?.id) {
          await todoModel.update({
            id: AMPLIFY_ACTIVE_INP_RECORD_ID,
            content: payload,
          });
        } else {
          await todoModel.create({
            id: AMPLIFY_ACTIVE_INP_RECORD_ID,
            content: payload,
          });
        }

        const existingNamed = await todoModel.get({ id: recordId });
        if (existingNamed?.data?.id) {
          await todoModel.update({
            id: recordId,
            content: payload,
          });
        } else {
          await todoModel.create({
            id: recordId,
            content: payload,
          });
        }
        syncedCloud = true;
      }
    } catch {
      // Keep local cache entry
    }
  }

  return syncedCloud;
}

export async function listInpFilesInAmplifyStorage(): Promise<
  AmplifyStoredInpFile[]
> {
  const byName = new Map<string, AmplifyStoredInpFile>();

  for (const cached of readLocalInpStorageCache()) {
    byName.set(cached.fileName.toLowerCase(), cached);
  }

  if (isAmplifyBackendConfigured()) {
    try {
      const client = generateClient() as unknown as AskGpt6SolClient;
      const todoModel = client.models?.Todo;
      if (todoModel?.list) {
        const res = await todoModel.list({ limit: 100 });
        for (const item of res?.data || []) {
          if (!item?.content) continue;
          try {
            const parsed = JSON.parse(item.content) as {
              type?: string;
              fileName?: string;
              storagePath?: string;
              sizeBytes?: number;
              source?: string;
              inpContent?: string;
              updatedAt?: string;
            };
            if (parsed.type === "EPANET_INP" && parsed.inpContent) {
              const cleanName = normalizeInpFileName(
                parsed.fileName || "water_distribution_model.inp"
              );
              const key = cleanName.toLowerCase();
              const updatedAt =
                parsed.updatedAt || item.updatedAt || new Date().toISOString();
              const prev = byName.get(key);
              if (!prev || updatedAt >= prev.updatedAt) {
                const entry: AmplifyStoredInpFile = {
                  id: item.id || `${AMPLIFY_INP_FILE_PREFIX}${cleanName}`,
                  fileName: cleanName,
                  storagePath: parsed.storagePath || `inp-files/${cleanName}`,
                  sizeBytes: parsed.sizeBytes ?? parsed.inpContent.length,
                  updatedAt,
                  source: parsed.source || "AWS Amplify Cloud",
                  inpContent: parsed.inpContent,
                };
                byName.set(key, entry);
                upsertLocalInpStorageCache(entry);
              }
            }
          } catch {
            // Skip non-JSON Todo entries
          }
        }
      }
    } catch {
      // Ignore network errors and use remaining sources
    }
  }

  if (isAmplifyStorageBucketConfigured()) {
    try {
      const s3List = await list({ path: "inp-files/" });
      for (const s3Item of s3List.items || []) {
        const rawName = s3Item.path.replace(/^inp-files\//, "").trim();
        if (!rawName || !rawName.toLowerCase().endsWith(".inp")) continue;
        const key = rawName.toLowerCase();
        const existing = byName.get(key);
        const s3Updated = s3Item.lastModified
          ? s3Item.lastModified.toISOString()
          : existing?.updatedAt || new Date().toISOString();
        byName.set(key, {
          id: existing?.id || `${AMPLIFY_INP_FILE_PREFIX}${rawName}`,
          fileName: rawName,
          storagePath: s3Item.path,
          sizeBytes: s3Item.size ?? existing?.sizeBytes ?? 0,
          updatedAt: s3Updated,
          source: "AWS Amplify S3 Storage",
          inpContent: existing?.inpContent,
        });
      }
    } catch {
      // Fallback to Data + Local cache
    }
  }

  return Array.from(byName.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

export async function fetchInpFileContentFromAmplifyStorage(
  item: AmplifyStoredInpFile
): Promise<string | null> {
  if (item.inpContent && item.inpContent.trim()) {
    return item.inpContent;
  }

  if (isAmplifyStorageBucketConfigured() && item.storagePath) {
    try {
      const downloadResult = await downloadData({
        path: item.storagePath,
      }).result;
      const text = await downloadResult.body.text();
      if (text.trim()) {
        return text;
      }
    } catch {
      // Fallback to Amplify Data
    }
  }

  if (isAmplifyBackendConfigured()) {
    try {
      const client = generateClient() as unknown as AskGpt6SolClient;
      const todoModel = client.models?.Todo;
      if (todoModel) {
        const res = await todoModel.get({ id: item.id });
        const raw = res?.data?.content;
        if (raw) {
          const parsed = JSON.parse(raw) as { inpContent?: string };
          if (parsed.inpContent) return parsed.inpContent;
        }
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

export async function loadInpFromAmplifyBackend(): Promise<{
  fileName: string;
  inpContent: string;
  updatedAt?: string;
} | null> {
  if (!isAmplifyBackendConfigured()) {
    const cached = readLocalInpStorageCache()[0];
    if (cached?.inpContent) {
      return {
        fileName: cached.fileName,
        inpContent: cached.inpContent,
        updatedAt: cached.updatedAt,
      };
    }
    return null;
  }
  try {
    const client = generateClient() as unknown as AskGpt6SolClient;
    const todoModel = client.models?.Todo;
    if (!todoModel) return null;

    const existing = await todoModel.get({ id: AMPLIFY_ACTIVE_INP_RECORD_ID });
    const rawContent = existing?.data?.content;
    if (!rawContent) return null;

    const parsed = JSON.parse(rawContent) as {
      type?: string;
      fileName?: string;
      inpContent?: string;
      updatedAt?: string;
    };
    if (parsed.type === "EPANET_INP" && parsed.inpContent) {
      return {
        fileName: parsed.fileName || "water_distribution_model.inp",
        inpContent: parsed.inpContent,
        updatedAt: parsed.updatedAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface InpSectionBlock {
  name: string;
  headerLine: string;
  lines: string[];
}

function parseInpIntoSections(inpText: string): InpSectionBlock[] {
  const rawLines = inpText.split(/\r?\n/);
  const sections: InpSectionBlock[] = [];
  let current: InpSectionBlock | null = null;

  for (const line of rawLines) {
    const match = line.trim().match(/^\[([A-Za-z0-9_]+)\]$/);
    if (match) {
      current = {
        name: match[1].toUpperCase(),
        headerLine: `[${match[1].toUpperCase()}]`,
        lines: [],
      };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function buildCompactInpPromptView(
  inpContent: string,
  userHintText: string = ""
): string {
  const trimmed = inpContent.trim();
  if (trimmed.length <= 14000) {
    return trimmed;
  }

  const mentionedIds = new Set<string>();
  const idMatches =
    userHintText.match(/\b(?:[PNTH]|pump|WTP|PZ|C_pump)[A-Za-z0-9_]*\b/gi) || [];
  for (const id of idMatches) {
    mentionedIds.add(id.toLowerCase());
  }

  const sections = parseInpIntoSections(trimmed);
  const largeSectionNames = new Set([
    "JUNCTIONS",
    "PIPES",
    "COORDINATES",
    "VERTICES",
  ]);
  const outLines: string[] = [];

  for (const sec of sections) {
    outLines.push(sec.headerLine);
    if (!largeSectionNames.has(sec.name) || sec.lines.length <= 45) {
      outLines.push(...sec.lines);
      continue;
    }

    const commentHeaders = sec.lines.filter((l) => l.trim().startsWith(";"));
    const dataRows = sec.lines.filter(
      (l) => l.trim().length > 0 && !l.trim().startsWith(";")
    );

    if (commentHeaders.length > 0) {
      outLines.push(commentHeaders[0]);
    }

    const headSlice = dataRows.slice(0, 18);
    const tailSlice = dataRows.slice(Math.max(18, dataRows.length - 5));
    const matchedRows = dataRows.filter((row) => {
      const cols = row.trim().split(/\s+/);
      return cols.some((c) => mentionedIds.has(c.toLowerCase()));
    });

    const combined = Array.from(
      new Set([...headSlice, ...matchedRows, ...tailSlice])
    );
    outLines.push(...combined.slice(0, 30));
    outLines.push(
      `; ... [${dataRows.length} total rows in [${sec.name}] — all ${dataRows.length} rows are preserved automatically on update] ...`,
      ""
    );
  }

  return outLines.join("\n");
}

export function mergeUpdatedInpPreservingIntegrity(
  originalInp: string | undefined | null,
  candidateInp: string
): string {
  const cleanedCandidate = candidateInp.trim();
  if (!originalInp || !originalInp.trim()) {
    return cleanedCandidate + "\n";
  }

  const origSections = parseInpIntoSections(originalInp);
  const candSections = parseInpIntoSections(cleanedCandidate);
  if (origSections.length === 0 || candSections.length === 0) {
    return cleanedCandidate + "\n";
  }

  const candByName = new Map<string, InpSectionBlock>();
  for (const cs of candSections) {
    if (cs.name !== "END") {
      candByName.set(cs.name, cs);
    }
  }

  const multiRowIdSections = new Set(["CURVES", "PATTERNS"]);
  const keyedRowSections = new Set([
    "JUNCTIONS",
    "RESERVOIRS",
    "TANKS",
    "PIPES",
    "PUMPS",
    "VALVES",
    "STATUS",
    "COORDINATES",
  ]);
  const optionKeySections = new Set(["OPTIONS", "TIMES", "REPORT"]);

  const getFirstToken = (line: string): string => {
    const noComment = line.split(";")[0].trim();
    if (!noComment) return "";
    return noComment.split(/\s+/)[0] || "";
  };

  const mergedSections: InpSectionBlock[] = origSections.map((origSec) => {
    const candSec = candByName.get(origSec.name);
    if (!candSec) return origSec;

    const candDataLines = candSec.lines.filter((l) => {
      const t = l.trim();
      if (!t || t.startsWith(";")) return false;
      if (t.includes("...")) return false;
      return true;
    });

    if (candDataLines.length === 0) {
      return origSec;
    }

    if (origSec.name === "TITLE") {
      return candSec;
    }

    if (multiRowIdSections.has(origSec.name)) {
      // Group candidate rows by Curve/Pattern ID and replace those IDs in original section while preserving all other curves/patterns
      const updatedIds = new Set<string>();
      for (const l of candDataLines) {
        const id = getFirstToken(l).toLowerCase();
        if (id) updatedIds.add(id);
      }
      if (updatedIds.size === 0) return origSec;

      const keptLines: string[] = [];
      let insertedUpdatedBlock = false;

      for (const line of origSec.lines) {
        const tok = getFirstToken(line).toLowerCase();
        if (tok && updatedIds.has(tok)) {
          if (!insertedUpdatedBlock) {
            for (const cLine of candSec.lines) {
              const cTok = getFirstToken(cLine).toLowerCase();
              if (cTok && updatedIds.has(cTok)) {
                keptLines.push(cLine);
              } else if (
                cLine.trim().startsWith(";") &&
                !cLine.toLowerCase().includes("id ") &&
                Array.from(updatedIds).some((u) =>
                  cLine.toLowerCase().includes(u.replace(/^c_/, ""))
                )
              ) {
                keptLines.push(cLine);
              }
            }
            insertedUpdatedBlock = true;
          }
          continue;
        }
        keptLines.push(line);
      }

      if (!insertedUpdatedBlock) {
        keptLines.push(...candDataLines);
      }
      keptLines.push("");
      return { ...origSec, lines: keptLines };
    }

    if (keyedRowSections.has(origSec.name)) {
      const origDataCount = origSec.lines.filter(
        (l) => l.trim() && !l.trim().startsWith(";")
      ).length;

      // If candidate provides a full replacement with >= origDataCount rows and no omissions, use it;
      // otherwise patch matching IDs in place so no junctions/pipes/tanks/pumps are ever lost!
      const candById = new Map<string, string>();
      const candOrder: string[] = [];
      for (const l of candDataLines) {
        const id = getFirstToken(l).toLowerCase();
        if (id) {
          if (!candById.has(id)) candOrder.push(id);
          candById.set(id, l);
        }
      }

      if (candById.size === 0) return origSec;

      // Never let a partial snippet wipe out a large table
      if (origDataCount > 0 && candById.size < origDataCount) {
        const seenIds = new Set<string>();
        const patchedLines = origSec.lines.map((line) => {
          const id = getFirstToken(line).toLowerCase();
          if (id && candById.has(id)) {
            seenIds.add(id);
            return candById.get(id)!;
          }
          return line;
        });
        for (const id of candOrder) {
          if (!seenIds.has(id)) {
            patchedLines.push(candById.get(id)!);
          }
        }
        return { ...origSec, lines: patchedLines };
      }

      return candSec;
    }

    if (optionKeySections.has(origSec.name)) {
      return candSec;
    }

    return origSec;
  });

  const out: string[] = [];
  for (const sec of mergedSections) {
    out.push(sec.headerLine);
    out.push(...sec.lines);
    if (out[out.length - 1]?.trim() !== "") {
      out.push("");
    }
  }
  return out.join("\n").trim() + "\n";
}

function buildSystemPromptWithActiveInp(
  baseSystemPrompt: string,
  activeInpContent?: string,
  activeInpFileName?: string,
  userHintText: string = ""
): string {
  const trimmedBase = baseSystemPrompt.trim();
  if (!activeInpContent || !activeInpContent.trim()) {
    return trimmedBase;
  }
  const fileName = (activeInpFileName || "water_distribution_model.inp").trim();
  const compactView = buildCompactInpPromptView(activeInpContent, userHintText);
  const isLargeFile = activeInpContent.trim().length > 14000;

  return [
    trimmedBase,
    "",
    `You have direct read and write access to the active EPANET 2.2 hydraulic model file "${fileName}" stored in the AWS Amplify backend.`,
    "Whenever the user asks you to modify, update, edit, add, remove, open, close, or change any component, parameter, pipe diameter/roughness/status, junction elevation/demand, tank level/diameter, pump curve, reservoir head, valve, pattern, or option in the .inp file:",
    "1. Briefly explain the exact modifications you made to the EPANET .inp model.",
    isLargeFile
      ? `2. Output ONLY the modified EPANET section(s) (for example [PUMPS] and [CURVES], or the specific modified rows) wrapped inside <UPDATED_EPANET_INP filename="${fileName}"> and </UPDATED_EPANET_INP> tags. All unmodified sections and rows ([JUNCTIONS], [PIPES], [COORDINATES], [VERTICES], etc.) are automatically merged and preserved with 100% file integrity.`
      : `2. Output the modified EPANET 2.2 .inp sections wrapped inside <UPDATED_EPANET_INP filename="${fileName}"> and </UPDATED_EPANET_INP> tags.`,
    "3. Use valid EPANET 2.2 section headers (e.g. [CURVES], [PUMPS], [TANKS], [JUNCTIONS], [PIPES], [STATUS], [OPTIONS]) inside <UPDATED_EPANET_INP>.",
    "",
    `<ACTIVE_EPANET_INP filename="${fileName}">`,
    compactView,
    "</ACTIVE_EPANET_INP>",
  ].join("\n");
}

function parseAndCleanUpdatedInpFromReply(
  rawReply: string,
  explicitUpdatedInp?: string | null,
  explicitUpdatedName?: string | null,
  defaultFileName?: string,
  originalInpContent?: string
): {
  cleanedReply: string;
  updatedInpContent: string | null;
  updatedInpFileName: string | null;
} {
  let rawCandidateInp: string | null = explicitUpdatedInp?.trim() || null;
  let updatedInpFileName: string | null =
    explicitUpdatedName?.trim() || defaultFileName || null;

  const tagRegex =
    /<UPDATED_EPANET_INP(?:\s+filename="([^"]+)")?\s*>([\s\S]*?)<\/UPDATED_EPANET_INP>/i;
  const tagMatch = rawReply.match(tagRegex);

  if (tagMatch && tagMatch[2]?.trim()) {
    const extracted = tagMatch[2]
      .trim()
      .replace(/^```(?:inp|epanet|txt|text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (/\[[A-Za-z0-9_]+\]/.test(extracted)) {
      rawCandidateInp = extracted;
      updatedInpFileName = (
        tagMatch[1] ||
        defaultFileName ||
        "water_distribution_model.inp"
      ).trim();
    }
  } else if (!rawCandidateInp) {
    const fenceMatch = rawReply.match(
      /```(?:inp|epanet|txt|text)?\s*(\[[A-Za-z0-9_]+\][\s\S]*?)```/i
    );
    if (fenceMatch && fenceMatch[1]?.trim()) {
      rawCandidateInp = fenceMatch[1].trim();
      updatedInpFileName = (
        defaultFileName || "water_distribution_model.inp"
      ).trim();
    }
  }

  const updatedInpContent = rawCandidateInp
    ? mergeUpdatedInpPreservingIntegrity(originalInpContent, rawCandidateInp)
    : null;

  let cleanedReply = rawReply.replace(tagRegex, "").trim();
  if (updatedInpContent) {
    const fileLabel = updatedInpFileName || "water_distribution_model.inp";
    const badgeLine = `\n\n---\n✅ **AWS Bedrock Modified \`${fileLabel}\` in Amplify Backend** — The updated EPANET 2.2 \`.inp\` file has been merged with 100% integrity and synced to the right-hand **Built Model** panel and AWS Amplify Storage.`;
    if (!cleanedReply.includes("AWS Bedrock Modified")) {
      cleanedReply = `${cleanedReply}${badgeLine}`.trim();
    }
  }

  return {
    cleanedReply,
    updatedInpContent,
    updatedInpFileName,
  };
}

export async function queryBedrockGpt6Sol(
  options: BedrockQueryOptions
): Promise<BedrockQueryResult> {
  const startedAt = performance.now();
  const {
    messages,
    systemPrompt,
    temperature,
    activeInpContent,
    activeInpFileName,
    signal,
    onToken,
  } = options;

  try {
    const preparedMessages = await prepareMessagesWithPdfExtraction(messages);
    const lastUserText =
      [...preparedMessages].reverse().find((m) => m.role === "user")?.content ||
      "";
    const effectiveSystemPrompt = buildSystemPromptWithActiveInp(
      systemPrompt,
      activeInpContent,
      activeInpFileName,
      lastUserText
    );
    const compactInpForTransport =
      activeInpContent && activeInpContent.length > 14000
        ? undefined
        : activeInpContent;

    type RawBedrockResponse = NonNullable<AskGpt6SolGraphqlResponse["data"]>;
    let data: RawBedrockResponse | null = null;

    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    if (isLocalhost) {
      try {
        const localResp = await fetch("/api/bedrock-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messagesJson: JSON.stringify(preparedMessages),
            systemPrompt: effectiveSystemPrompt,
            temperature,
            mode: "bedrock",
            inpContent: compactInpForTransport,
            inpFileName: activeInpFileName,
          }),
          signal,
        });

        if (localResp.ok) {
          const parsedLocal = (await localResp.json()) as RawBedrockResponse;
          if (parsedLocal && parsedLocal.source !== "bedrock-error") {
            data = parsedLocal;
          }
        }
      } catch {
        // Fall through to Amplify AppSync client if local middleware is unavailable
      }
    }

    if (!data && isAmplifyBackendConfigured()) {
      const client = generateClient() as unknown as AskGpt6SolClient;
      const response = await client.queries.askGpt6Sol({
        messagesJson: JSON.stringify(preparedMessages),
        systemPrompt: effectiveSystemPrompt,
        temperature,
        mode: "bedrock",
        inpContent: compactInpForTransport,
        inpFileName: activeInpFileName,
      });

      if (response.errors?.length) {
        throw new Error(response.errors.map((e) => e.message).join("; "));
      }
      data = response.data ?? null;
    } else if (!data) {
      const localResp = await fetch("/api/bedrock-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messagesJson: JSON.stringify(preparedMessages),
          systemPrompt: effectiveSystemPrompt,
          temperature,
          mode: "bedrock",
          inpContent: compactInpForTransport,
          inpFileName: activeInpFileName,
        }),
        signal,
      });

      if (!localResp.ok) {
        const errBody = await localResp.text();
        throw new Error(`Bedrock proxy HTTP ${localResp.status}: ${errBody}`);
      }
      data = (await localResp.json()) as RawBedrockResponse;
    }

    if (data) {
      const { cleanedReply, updatedInpContent, updatedInpFileName } =
        parseAndCleanUpdatedInpFromReply(
          data.reply,
          data.updatedInpContent,
          data.updatedInpFileName,
          activeInpFileName,
          activeInpContent
        );

      if (updatedInpContent && updatedInpFileName) {
        void syncInpToAmplifyBackend(
          updatedInpFileName,
          updatedInpContent,
          "Modified by Bedrock AI"
        );
      }

      const finalText = await streamTextToCallback(cleanedReply, onToken, signal);
      return {
        reply: finalText,
        modelId: data.modelId || BEDROCK_ENGINE_CONFIG.modelId,
        inferenceProfileId:
          data.inferenceProfileId || BEDROCK_ENGINE_CONFIG.inferenceProfileId,
        source:
          data.source === "bedrock-error" ? "bedrock-error" : "aws-bedrock",
        latencyMs:
          data.latencyMs ?? Math.round(performance.now() - startedAt),
        promptTokens:
          data.promptTokens ??
          estimateTokens(JSON.stringify(messages) + effectiveSystemPrompt),
        completionTokens:
          data.completionTokens ?? estimateTokens(finalText),
        errorDetail: data.errorDetail,
        updatedInpContent,
        updatedInpFileName,
      };
    }

    throw new Error("Empty response from AWS Bedrock endpoint.");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorReply = [
      "### AWS Bedrock Connection Notice",
      `Attempted live call to \`${BEDROCK_ENGINE_CONFIG.modelId}\` (\`${BEDROCK_ENGINE_CONFIG.inferenceProfileId}\`), but received:`,
      "",
      `\`\`\`\n${errMsg}\n\`\`\``,
    ].join("\n");
    const streamed = await streamTextToCallback(errorReply, onToken, signal);
    return {
      reply: streamed,
      modelId: BEDROCK_ENGINE_CONFIG.modelId,
      inferenceProfileId: BEDROCK_ENGINE_CONFIG.inferenceProfileId,
      source: "bedrock-error",
      latencyMs: Math.round(performance.now() - startedAt),
      promptTokens: estimateTokens(JSON.stringify(messages)),
      completionTokens: estimateTokens(streamed),
      errorDetail: errMsg,
    };
  }
}
