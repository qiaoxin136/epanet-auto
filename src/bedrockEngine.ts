import { generateClient } from "aws-amplify/data";
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
    }) => Promise<AskGpt6SolGraphqlResponse>;
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
}

export const BEDROCK_ENGINE_CONFIG = {
  provider: "OpenAI (via AWS Bedrock)",
  modelName: "GPT-6 Sol",
  modelId: "openai.gpt-6-sol",
  inferenceProfileId: "us.openai.gpt-6-sol",
  globalProfileId: "global.openai.gpt-6-sol",
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

export async function queryBedrockGpt6Sol(
  options: BedrockQueryOptions
): Promise<BedrockQueryResult> {
  const startedAt = performance.now();
  const { messages, systemPrompt, temperature, signal, onToken } = options;

  try {
    const preparedMessages = await prepareMessagesWithPdfExtraction(messages);

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
            systemPrompt,
            temperature,
            mode: "bedrock",
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
        systemPrompt,
        temperature,
        mode: "bedrock",
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
          systemPrompt,
          temperature,
          mode: "bedrock",
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
      const finalText = await streamTextToCallback(data.reply, onToken, signal);
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
          estimateTokens(JSON.stringify(messages) + systemPrompt),
        completionTokens:
          data.completionTokens ?? estimateTokens(finalText),
        errorDetail: data.errorDetail,
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
