import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Hash } from "@smithy/hash-node";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

declare const process: { env: Record<string, string | undefined> };

interface ChatImageAttachment {
  id?: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  dataUrl?: string;
  width?: number;
  height?: number;
  pageCount?: number;
  extractedText?: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatImageAttachment[];
}

interface AskGpt6SolEvent {
  arguments: {
    messagesJson: string;
    systemPrompt?: string | null;
    temperature?: number | null;
    mode?: string | null;
  };
}

interface BedrockConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: Array<{ text?: string }>;
    };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

type BedrockContentBlock =
  | { text: string }
  | {
      image: {
        format: "png" | "jpeg" | "gif" | "webp";
        source: { bytes: string };
      };
    }
  | {
      document: {
        format: "pdf";
        name: string;
        source: { bytes: string };
      };
    };

function parseDataUrlImage(
  att: ChatImageAttachment
): { format: "png" | "jpeg" | "gif" | "webp"; bytes: string } | null {
  if (!att.dataUrl) return null;
  const match = att.dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  const rawFormat = match[1].toLowerCase();
  const base64Bytes = match[2];
  let format: "png" | "jpeg" | "gif" | "webp" | null = null;
  if (rawFormat === "png") format = "png";
  else if (rawFormat === "jpeg" || rawFormat === "jpg") format = "jpeg";
  else if (rawFormat === "gif") format = "gif";
  else if (rawFormat === "webp") format = "webp";
  if (!format) return null;
  return { format, bytes: base64Bytes };
}

function parseDataUrlPdf(
  att: ChatImageAttachment
): { name: string; bytes: string } | null {
  if (!att.dataUrl) return null;
  const isPdf =
    att.mimeType === "application/pdf" || /\.pdf$/i.test(att.name || "");
  if (!isPdf) return null;
  const match = att.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  // Bedrock Converse document.name allows alphanumeric, whitespace, hyphens, parentheses, and square brackets (no periods)
  const sanitizedName =
    (att.name || "document")
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9\s\-()[\]]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "pdf-document";
  return { name: sanitizedName, bytes: match[1] };
}

function normalizeMessagesForBedrock(
  messages: ChatTurn[],
  includeImageBytes: boolean
): Array<{
  role: "user" | "assistant";
  content: BedrockContentBlock[];
}> {
  const cleaned: Array<{
    role: "user" | "assistant";
    content: BedrockContentBlock[];
  }> = [];

  for (const m of messages) {
    const role: "user" | "assistant" =
      m.role === "assistant" ? "assistant" : "user";
    const blocks: BedrockContentBlock[] = [];

    if (role === "user" && m.attachments && m.attachments.length > 0) {
      const hasAnyRasterImage = m.attachments.some((a) =>
        Boolean(parseDataUrlImage(a))
      );

      for (let idx = 0; idx < m.attachments.length; idx++) {
        const att = m.attachments[idx];
        if (includeImageBytes) {
          const parsedImg = parseDataUrlImage(att);
          if (parsedImg) {
            blocks.push({
              text: `[Attached Visual Image ${idx + 1}: "${
                att.name || `Image ${idx + 1}`
              }"]`,
            });
            blocks.push({
              image: {
                format: parsedImg.format,
                source: { bytes: parsedImg.bytes },
              },
            });
            continue;
          }
          // Only attach raw PDF document block if no rendered page images are present
          if (!hasAnyRasterImage) {
            const parsedPdf = parseDataUrlPdf(att);
            if (parsedPdf) {
              blocks.push({
                document: {
                  format: "pdf",
                  name: parsedPdf.name,
                  source: { bytes: parsedPdf.bytes },
                },
              });
            }
          }
        }
      }
    }

    const pdfTextBlocks = (m.attachments || [])
      .filter((a) => Boolean(a.extractedText && a.extractedText.trim()))
      .map(
        (a, idx) =>
          `=== ATTACHED PDF DOCUMENT ${idx + 1}: "${a.name}" (${
            a.pageCount || 1
          } page(s)) ===\n${a.extractedText!.trim()}\n=== END OF "${a.name}" ===`
      )
      .join("\n\n");

    const attachmentNote =
      m.attachments && m.attachments.length > 0
        ? `\n[Attached file(s): ${m.attachments
            .map((a) => `${a.name} (${a.mimeType})`)
            .join(", ")}]`
        : "";

    let text = (m.content || "").trim();
    if (pdfTextBlocks && !text.includes("=== ATTACHED PDF DOCUMENT")) {
      text = `${text}\n\n${pdfTextBlocks}`.trim();
    }
    if (!includeImageBytes && attachmentNote) {
      text = `${text}${attachmentNote}`.trim();
    }

    if (text && text !== "...") {
      blocks.push({ text });
    } else if (blocks.length > 0) {
      blocks.push({ text: "Please analyze the attached file(s)." });
    }

    if (blocks.length === 0) continue;

    // Bedrock Converse requires the conversation to begin with a "user" message
    if (cleaned.length === 0 && role !== "user") {
      continue;
    }

    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === role) {
      prev.content.push(...blocks);
    } else {
      cleaned.push({ role, content: blocks });
    }
  }

  if (cleaned.length === 0) {
    cleaned.push({
      role: "user",
      content: [{ text: "Hello!" }],
    });
  }

  return cleaned;
}

async function invokeBedrockConverse(
  region: string,
  modelOrProfileId: string,
  messages: ChatTurn[],
  systemPrompt?: string | null,
  temperature?: number | null,
  includeImageBytes: boolean = true
): Promise<BedrockConverseResponse> {
  const hostname = `bedrock-runtime.${region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(modelOrProfileId)}/converse`;

  const normalizedMessages = normalizeMessagesForBedrock(
    messages,
    includeImageBytes
  );

  const bodyObj: Record<string, unknown> = {
    messages: normalizedMessages,
    inferenceConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.7,
      maxTokens: 4096,
    },
  };

  if (systemPrompt && systemPrompt.trim()) {
    bodyObj.system = [{ text: systemPrompt.trim() }];
  }

  const body = JSON.stringify(bodyObj);

  const request = new HttpRequest({
    method: "POST",
    protocol: "https:",
    hostname,
    path,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      host: hostname,
    },
    body,
  });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: "bedrock",
    sha256: Hash.bind(null, "sha256"),
  });

  const signed = await signer.sign(request);
  const response = await fetch(`https://${hostname}${path}`, {
    method: signed.method,
    headers: signed.headers as Record<string, string>,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bedrock HTTP ${response.status}: ${errorText}`);
  }

  return (await response.json()) as BedrockConverseResponse;
}

export const handler = async (event: AskGpt6SolEvent) => {
  const startedAt = Date.now();
  const engineId = process.env.BEDROCK_ENGINE_ID || "openai.gpt-6-sol";
  const profileId =
    process.env.BEDROCK_INFERENCE_PROFILE_ID || "us.openai.gpt-6-sol";
  const region =
    process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-2";

  let messages: ChatTurn[] = [];
  try {
    messages = JSON.parse(event.arguments.messagesJson || "[]");
  } catch {
    messages = [
      { role: "user", content: String(event.arguments.messagesJson || "") },
    ];
  }

  const hasImages = messages.some(
    (m) => m.attachments && m.attachments.length > 0
  );

  // Live AWS Bedrock Only: when images/PDF page visuals are attached, strictly use multimodal vision models
  const candidateAttempts: Array<{ model: string; withImages: boolean }> =
    hasImages
      ? [
          { model: "us.meta.llama4-maverick-17b-instruct-v1:0", withImages: true },
          { model: "us.amazon.nova-pro-v1:0", withImages: true },
          { model: "us.meta.llama4-scout-17b-instruct-v1:0", withImages: true },
          { model: "us.amazon.nova-2-lite-v1:0", withImages: true },
          { model: "us.amazon.nova-lite-v1:0", withImages: true },
        ]
      : [
          { model: profileId, withImages: false },
          { model: "global.openai.gpt-6-sol", withImages: false },
          { model: "openai.gpt-oss-120b-1:0", withImages: false },
          { model: "us.meta.llama4-maverick-17b-instruct-v1:0", withImages: false },
          { model: "us.amazon.nova-pro-v1:0", withImages: false },
          { model: "us.amazon.nova-lite-v1:0", withImages: false },
        ];

  let primaryError = "";
  let lastError = "";

  for (const attempt of candidateAttempts) {
    try {
      const result = await invokeBedrockConverse(
        region,
        attempt.model,
        messages,
        event.arguments.systemPrompt,
        event.arguments.temperature,
        attempt.withImages
      );

      const text =
        result.output?.message?.content
          ?.map((block) => block.text || "")
          .join("\n")
          .trim() || "No response text returned from Bedrock.";

      return {
        reply: text,
        modelId: engineId,
        inferenceProfileId: attempt.model,
        source: "aws-bedrock",
        latencyMs: Date.now() - startedAt,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        errorDetail: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!primaryError) primaryError = msg;
      lastError = msg;
    }
  }

  const errDetail = primaryError || lastError || "Unknown AWS Bedrock error";
  return {
    reply: `AWS Bedrock invocation error for \`${engineId}\` (\`${profileId}\`): ${errDetail}`,
    modelId: engineId,
    inferenceProfileId: profileId,
    source: "bedrock-error",
    latencyMs: Date.now() - startedAt,
    promptTokens: 0,
    completionTokens: 0,
    errorDetail: errDetail,
  };
};

