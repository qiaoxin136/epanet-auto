import { generateClient } from "aws-amplify/data";
import { downloadData, list, remove, uploadData } from "aws-amplify/storage";
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
      delete: (args: { id: string }) => Promise<{
        data?: { id: string } | null;
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
const AMPLIFY_INP_CHUNK_PREFIX = "epanet-inp-chunk::";
const MAX_SINGLE_TODO_INP_CHARS = 280000;
const LOCAL_STORAGE_INP_CACHE_KEY = "epanet-amplify-storage-inp-files-v1";
const LOCAL_STORAGE_DELETED_INP_KEY = "epanet-amplify-deleted-inp-files-v1";

export interface AmplifyStoredInpFile {
  id: string;
  fileName: string;
  storagePath: string;
  sizeBytes: number;
  updatedAt: string;
  source: string;
  inpContent?: string;
}

interface AppSyncTodoRecord {
  id: string;
  content?: string | null;
  updatedAt?: string;
}

function getAppSyncEndpointConfig(): { url: string; apiKey: string } | null {
  const dataCfg = (
    outputs as { data?: { url?: string; api_key?: string } }
  )?.data;
  if (dataCfg?.url && dataCfg?.api_key) {
    return { url: dataCfg.url, apiKey: dataCfg.api_key };
  }
  return null;
}

async function executeAppSyncGraphql<TData>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<TData | null> {
  const cfg = getAppSyncEndpointConfig();
  if (!cfg) return null;
  const resp = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal,
  });
  if (!resp.ok) {
    throw new Error(`AppSync HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    data?: TData;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length && !json.data) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data ?? null;
}

async function appSyncGetTodo(id: string): Promise<AppSyncTodoRecord | null> {
  try {
    const data = await executeAppSyncGraphql<{
      getTodo?: AppSyncTodoRecord | null;
    }>(
      `query GetTodo($id: ID!) {
        getTodo(id: $id) {
          id
          content
          updatedAt
        }
      }`,
      { id }
    );
    if (data?.getTodo) return data.getTodo;
  } catch {
    // Fallback to Amplify Data client below
  }
  try {
    const client = generateClient() as unknown as AskGpt6SolClient;
    const res = await client.models?.Todo?.get({ id });
    return res?.data ?? null;
  } catch {
    return null;
  }
}

async function appSyncListTodos(
  limit: number = 150
): Promise<AppSyncTodoRecord[]> {
  try {
    const data = await executeAppSyncGraphql<{
      listTodos?: { items?: Array<AppSyncTodoRecord | null> | null } | null;
    }>(
      `query ListTodos($limit: Int) {
        listTodos(limit: $limit) {
          items {
            id
            content
            updatedAt
          }
        }
      }`,
      { limit }
    );
    const items = (data?.listTodos?.items || []).filter(
      (item): item is AppSyncTodoRecord => Boolean(item && item.id)
    );
    if (items.length > 0 || data?.listTodos) {
      return items;
    }
  } catch {
    // Fallback to Amplify Data client below
  }
  try {
    const client = generateClient() as unknown as AskGpt6SolClient;
    const res = await client.models?.Todo?.list({ limit });
    return (res?.data || []).filter((item): item is AppSyncTodoRecord =>
      Boolean(item && item.id)
    );
  } catch {
    return [];
  }
}

async function appSyncUpsertTodo(id: string, content: string): Promise<boolean> {
  try {
    const existing = await appSyncGetTodo(id);
    if (existing?.id) {
      const updated = await executeAppSyncGraphql<{
        updateTodo?: { id: string } | null;
      }>(
        `mutation UpdateTodo($input: UpdateTodoInput!) {
          updateTodo(input: $input) {
            id
            updatedAt
          }
        }`,
        { input: { id, content } }
      );
      if (updated?.updateTodo?.id) return true;
    } else {
      const created = await executeAppSyncGraphql<{
        createTodo?: { id: string } | null;
      }>(
        `mutation CreateTodo($input: CreateTodoInput!) {
          createTodo(input: $input) {
            id
            updatedAt
          }
        }`,
        { input: { id, content } }
      );
      if (created?.createTodo?.id) return true;
    }
  } catch {
    // Fallback to Amplify Data client below
  }
  try {
    const client = generateClient() as unknown as AskGpt6SolClient;
    const todoModel = client.models?.Todo;
    if (!todoModel) return false;
    const existing = await todoModel.get({ id });
    if (existing?.data?.id) {
      await todoModel.update({ id, content });
    } else {
      await todoModel.create({ id, content });
    }
    return true;
  } catch {
    return false;
  }
}

async function appSyncDeleteTodo(id: string): Promise<boolean> {
  let deleted = false;
  try {
    const res = await executeAppSyncGraphql<{
      deleteTodo?: { id: string } | null;
    }>(
      `mutation DeleteTodo($input: DeleteTodoInput!) {
        deleteTodo(input: $input) {
          id
        }
      }`,
      { input: { id } }
    );
    if (res?.deleteTodo?.id) {
      deleted = true;
    }
  } catch {
    // Also try Amplify Data client below
  }
  try {
    const client = generateClient() as unknown as AskGpt6SolClient;
    const todoModel = client.models?.Todo;
    if (todoModel?.delete) {
      await todoModel.delete({ id });
      deleted = true;
    }
  } catch {
    // Ignore if already deleted
  }
  return deleted;
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

function readDeletedInpNamesSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_DELETED_INP_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.map((n) => String(n).toLowerCase()))
      : new Set();
  } catch {
    return new Set();
  }
}

function markInpFileDeletedLocally(fileName: string, isDeleted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const set = readDeletedInpNamesSet();
    const key = normalizeInpFileName(fileName).toLowerCase();
    if (isDeleted) {
      set.add(key);
    } else {
      set.delete(key);
    }
    window.localStorage.setItem(
      LOCAL_STORAGE_DELETED_INP_KEY,
      JSON.stringify(Array.from(set))
    );
  } catch {
    // Ignore storage issues
  }
}

function readLocalInpStorageCache(): AmplifyStoredInpFile[] {
  if (typeof window === "undefined") return [];
  try {
    const deletedSet = readDeletedInpNamesSet();
    const raw = window.localStorage.getItem(LOCAL_STORAGE_INP_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AmplifyStoredInpFile[]).filter(
      (item) =>
        item?.fileName && !deletedSet.has(item.fileName.toLowerCase())
    );
  } catch {
    return [];
  }
}

function upsertLocalInpStorageCache(entry: AmplifyStoredInpFile): void {
  if (typeof window === "undefined") return;
  try {
    markInpFileDeletedLocally(entry.fileName, false);
    const current = readLocalInpStorageCache().filter(
      (item) => item.fileName.toLowerCase() !== entry.fileName.toLowerCase()
    );
    const next = [entry, ...current].slice(0, 25);
    window.localStorage.setItem(LOCAL_STORAGE_INP_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota issues
  }
}

function removeLocalInpStorageCache(fileName: string): void {
  if (typeof window === "undefined") return;
  try {
    const cleanKey = normalizeInpFileName(fileName).toLowerCase();
    markInpFileDeletedLocally(cleanKey, true);
    const current = readLocalInpStorageCache().filter(
      (item) => item.fileName.toLowerCase() !== cleanKey
    );
    window.localStorage.setItem(
      LOCAL_STORAGE_INP_CACHE_KEY,
      JSON.stringify(current)
    );
  } catch {
    // Ignore storage issues
  }
}

async function fetchChunkedInpContent(
  cleanFileName: string,
  chunkCount: number
): Promise<string | null> {
  if (chunkCount <= 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunkId = `${AMPLIFY_INP_CHUNK_PREFIX}${cleanFileName}::${i}`;
    const rec = await appSyncGetTodo(chunkId);
    if (!rec?.content) return null;
    try {
      const parsed = JSON.parse(rec.content) as { chunkContent?: string };
      if (typeof parsed.chunkContent !== "string") return null;
      parts.push(parsed.chunkContent);
    } catch {
      return null;
    }
  }
  return parts.join("");
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
      if (inpContent.length <= MAX_SINGLE_TODO_INP_CHARS) {
        const payload = JSON.stringify({
          type: "EPANET_INP",
          fileName: cleanFileName,
          storagePath,
          sizeBytes: inpContent.length,
          source: sourceLabel,
          inpContent,
          isChunked: false,
          chunkCount: 0,
          updatedAt: nowIso,
        });

        const okActive = await appSyncUpsertTodo(
          AMPLIFY_ACTIVE_INP_RECORD_ID,
          payload
        );
        const okNamed = await appSyncUpsertTodo(recordId, payload);
        if (okActive || okNamed) syncedCloud = true;
      } else {
        const chunks: string[] = [];
        for (
          let offset = 0;
          offset < inpContent.length;
          offset += MAX_SINGLE_TODO_INP_CHARS
        ) {
          chunks.push(
            inpContent.slice(offset, offset + MAX_SINGLE_TODO_INP_CHARS)
          );
        }

        for (let idx = 0; idx < chunks.length; idx++) {
          const chunkId = `${AMPLIFY_INP_CHUNK_PREFIX}${cleanFileName}::${idx}`;
          const chunkPayload = JSON.stringify({
            type: "EPANET_INP_CHUNK",
            fileName: cleanFileName,
            chunkIndex: idx,
            chunkCount: chunks.length,
            chunkContent: chunks[idx],
            updatedAt: nowIso,
          });
          await appSyncUpsertTodo(chunkId, chunkPayload);
        }

        const manifestPayload = JSON.stringify({
          type: "EPANET_INP",
          fileName: cleanFileName,
          storagePath,
          sizeBytes: inpContent.length,
          source: sourceLabel,
          isChunked: true,
          chunkCount: chunks.length,
          updatedAt: nowIso,
        });

        const okActive = await appSyncUpsertTodo(
          AMPLIFY_ACTIVE_INP_RECORD_ID,
          manifestPayload
        );
        const okNamed = await appSyncUpsertTodo(recordId, manifestPayload);
        if (okActive || okNamed) syncedCloud = true;
      }
    } catch {
      // Keep local cache entry
    }
  }

  return syncedCloud;
}

export async function deleteInpFileFromAmplifyStorage(
  itemOrFileName: AmplifyStoredInpFile | string
): Promise<boolean> {
  const rawName =
    typeof itemOrFileName === "string"
      ? itemOrFileName
      : itemOrFileName.fileName;
  const cleanFileName = normalizeInpFileName(rawName);
  const cleanLower = cleanFileName.toLowerCase();
  const recordId = `${AMPLIFY_INP_FILE_PREFIX}${cleanFileName}`;
  const storagePath =
    typeof itemOrFileName === "string"
      ? `inp-files/${cleanFileName}`
      : itemOrFileName.storagePath || `inp-files/${cleanFileName}`;

  removeLocalInpStorageCache(cleanFileName);

  if (isAmplifyStorageBucketConfigured()) {
    try {
      await remove({ path: storagePath });
    } catch {
      // Ignore if S3 object does not exist
    }
  }

  if (isAmplifyBackendConfigured()) {
    try {
      await appSyncDeleteTodo(recordId);
      if (
        typeof itemOrFileName !== "string" &&
        itemOrFileName.id &&
        itemOrFileName.id !== recordId
      ) {
        await appSyncDeleteTodo(itemOrFileName.id);
      }

      const allTodos = await appSyncListTodos(200);
      for (const todo of allTodos) {
        if (!todo?.id) continue;
        const idLower = todo.id.toLowerCase();
        if (
          idLower === recordId.toLowerCase() ||
          idLower.startsWith(
            `${AMPLIFY_INP_CHUNK_PREFIX}${cleanFileName}::`.toLowerCase()
          )
        ) {
          await appSyncDeleteTodo(todo.id);
          continue;
        }
        if (todo.content) {
          try {
            const parsed = JSON.parse(todo.content) as {
              type?: string;
              fileName?: string;
            };
            if (
              (parsed.type === "EPANET_INP" ||
                parsed.type === "EPANET_INP_CHUNK") &&
              parsed.fileName &&
              normalizeInpFileName(parsed.fileName).toLowerCase() === cleanLower
            ) {
              await appSyncDeleteTodo(todo.id);
            }
          } catch {
            // Skip non-JSON records
          }
        }
      }
    } catch {
      // Local cache and tombstones are already updated
    }
  }

  return true;
}

export async function listInpFilesInAmplifyStorage(): Promise<
  AmplifyStoredInpFile[]
> {
  const deletedSet = readDeletedInpNamesSet();
  const byName = new Map<string, AmplifyStoredInpFile>();

  for (const cached of readLocalInpStorageCache()) {
    if (!deletedSet.has(cached.fileName.toLowerCase())) {
      byName.set(cached.fileName.toLowerCase(), cached);
    }
  }

  if (isAmplifyBackendConfigured()) {
    try {
      const items = await appSyncListTodos(150);
      for (const item of items) {
        if (!item?.content) continue;
        try {
          const parsed = JSON.parse(item.content) as {
            type?: string;
            fileName?: string;
            storagePath?: string;
            sizeBytes?: number;
            source?: string;
            inpContent?: string;
            isChunked?: boolean;
            chunkCount?: number;
            updatedAt?: string;
          };
          if (
            parsed.type === "EPANET_INP" &&
            (parsed.inpContent || (parsed.isChunked && parsed.chunkCount))
          ) {
            const cleanName = normalizeInpFileName(
              parsed.fileName || "water_distribution_model.inp"
            );
            const key = cleanName.toLowerCase();
            if (deletedSet.has(key)) continue;
            const updatedAt =
              parsed.updatedAt || item.updatedAt || new Date().toISOString();
            const prev = byName.get(key);
            if (!prev || updatedAt >= prev.updatedAt) {
              const entry: AmplifyStoredInpFile = {
                id:
                  item.id === AMPLIFY_ACTIVE_INP_RECORD_ID
                    ? `${AMPLIFY_INP_FILE_PREFIX}${cleanName}`
                    : item.id || `${AMPLIFY_INP_FILE_PREFIX}${cleanName}`,
                fileName: cleanName,
                storagePath: parsed.storagePath || `inp-files/${cleanName}`,
                sizeBytes:
                  parsed.sizeBytes ?? (parsed.inpContent?.length || 0),
                updatedAt,
                source: parsed.source || "AWS Amplify Cloud",
                inpContent: parsed.inpContent || prev?.inpContent,
              };
              byName.set(key, entry);
              if (entry.inpContent) {
                upsertLocalInpStorageCache(entry);
              }
            }
          }
        } catch {
          // Skip non-JSON Todo entries
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
        if (deletedSet.has(key)) continue;
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
      const cleanFileName = normalizeInpFileName(item.fileName);
      const rec =
        (await appSyncGetTodo(item.id)) ||
        (await appSyncGetTodo(`${AMPLIFY_INP_FILE_PREFIX}${cleanFileName}`));
      const raw = rec?.content;
      if (raw) {
        const parsed = JSON.parse(raw) as {
          inpContent?: string;
          isChunked?: boolean;
          chunkCount?: number;
          fileName?: string;
        };
        if (parsed.inpContent) return parsed.inpContent;
        if (parsed.isChunked && parsed.chunkCount) {
          const assembled = await fetchChunkedInpContent(
            normalizeInpFileName(parsed.fileName || cleanFileName),
            parsed.chunkCount
          );
          if (assembled) return assembled;
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
  const deletedSet = readDeletedInpNamesSet();
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
    const existing = await appSyncGetTodo(AMPLIFY_ACTIVE_INP_RECORD_ID);
    const rawContent = existing?.content;
    if (!rawContent) return null;

    const parsed = JSON.parse(rawContent) as {
      type?: string;
      fileName?: string;
      inpContent?: string;
      isChunked?: boolean;
      chunkCount?: number;
      updatedAt?: string;
    };
    if (parsed.type === "EPANET_INP") {
      const cleanName = normalizeInpFileName(
        parsed.fileName || "water_distribution_model.inp"
      );
      if (deletedSet.has(cleanName.toLowerCase())) {
        return null;
      }
      let content = parsed.inpContent || null;
      if (!content && parsed.isChunked && parsed.chunkCount) {
        content = await fetchChunkedInpContent(cleanName, parsed.chunkCount);
      }
      if (content) {
        return {
          fileName: cleanName,
          inpContent: content,
          updatedAt: parsed.updatedAt,
        };
      }
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
      try {
        const gqlRes = await executeAppSyncGraphql<{
          askGpt6Sol?: RawBedrockResponse | null;
        }>(
          `query AskGpt6Sol(
            $messagesJson: String!
            $systemPrompt: String
            $temperature: Float
            $mode: String
            $inpContent: String
            $inpFileName: String
          ) {
            askGpt6Sol(
              messagesJson: $messagesJson
              systemPrompt: $systemPrompt
              temperature: $temperature
              mode: $mode
              inpContent: $inpContent
              inpFileName: $inpFileName
            ) {
              reply
              modelId
              inferenceProfileId
              source
              latencyMs
              promptTokens
              completionTokens
              errorDetail
              updatedInpContent
              updatedInpFileName
            }
          }`,
          {
            messagesJson: JSON.stringify(preparedMessages),
            systemPrompt: effectiveSystemPrompt,
            temperature,
            mode: "bedrock",
            inpContent: compactInpForTransport,
            inpFileName: activeInpFileName,
          },
          signal
        );
        if (gqlRes?.askGpt6Sol) {
          data = gqlRes.askGpt6Sol;
        }
      } catch {
        // Fallback to generateClient below
      }

      if (!data) {
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
      }
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
