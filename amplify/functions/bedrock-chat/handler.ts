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
    inpContent?: string | null;
    inpFileName?: string | null;
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

  const hideSampling =
    modelOrProfileId.includes("claude-opus-5") ||
    modelOrProfileId.includes("claude-fable-5");

  const bodyObj: Record<string, unknown> = {
    messages: normalizedMessages,
    inferenceConfig: hideSampling
      ? { maxTokens: 4096 }
      : {
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

function buildSystemPromptWithInp(
  baseSystemPrompt?: string | null,
  inpContent?: string | null,
  inpFileName?: string | null
): string {
  const base = (
    baseSystemPrompt ||
    "You are Claude Opus 5 (anthropic.claude-opus-5) paired with the build-epanet hydraulic modeling agent on AWS Bedrock."
  ).trim();

  if (!inpContent || !inpContent.trim()) {
    return base;
  }

  // Avoid duplicating if the client already appended <ACTIVE_EPANET_INP> into systemPrompt
  if (base.includes("<ACTIVE_EPANET_INP")) {
    return base;
  }

  const fileName = (inpFileName || "water_distribution_model.inp").trim();
  return [
    base,
    "",
    `You have direct read and write access to the active EPANET 2.2 hydraulic model file "${fileName}" in the AWS Amplify backend.`,
    "Whenever the user asks you to modify, update, edit, add, remove, open, close, or change any component, parameter, pipe diameter/roughness/status, junction elevation/demand, tank level/diameter, pump curve, reservoir head, valve, pattern, or option in the .inp file:",
    "1. Briefly explain the exact modifications you made to the EPANET model.",
    `2. Output the COMPLETE modified EPANET 2.2 .inp file wrapped inside <UPDATED_EPANET_INP filename="${fileName}"> and </UPDATED_EPANET_INP> tags.`,
    "3. Preserve all existing sections ([TITLE], [JUNCTIONS], [RESERVOIRS], [TANKS], [PIPES], [PUMPS], [VALVES], [STATUS], [PATTERNS], [CURVES], [TIMES], [REPORT], [OPTIONS], [COORDINATES], [VERTICES], [END]) and only change the lines requested by the user.",
    "",
    `<ACTIVE_EPANET_INP filename="${fileName}">`,
    inpContent.trim(),
    "</ACTIVE_EPANET_INP>",
  ].join("\n");
}

function extractUpdatedInpFromReply(
  replyText: string,
  defaultFileName?: string | null
): {
  updatedInpContent: string | null;
  updatedInpFileName: string | null;
} {
  const tagMatch = replyText.match(
    /<UPDATED_EPANET_INP(?:\s+filename="([^"]+)")?\s*>([\s\S]*?)<\/UPDATED_EPANET_INP>/i
  );
  if (tagMatch && tagMatch[2]?.trim()) {
    const cleaned = tagMatch[2]
      .trim()
      .replace(/^```(?:inp|epanet|txt|text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (cleaned.includes("[JUNCTIONS]") || cleaned.includes("[PIPES]")) {
      return {
        updatedInpContent: cleaned + "\n",
        updatedInpFileName:
          (tagMatch[1] || defaultFileName || "water_distribution_model.inp").trim(),
      };
    }
  }

  // Fallback: check if the model emitted a full EPANET .inp inside a markdown code fence
  const fenceMatch = replyText.match(
    /```(?:inp|epanet|txt|text)?\s*(\[TITLE\][\s\S]*?\[END\])\s*```/i
  );
  if (fenceMatch && fenceMatch[1]?.trim()) {
    return {
      updatedInpContent: fenceMatch[1].trim() + "\n",
      updatedInpFileName: (
        defaultFileName || "water_distribution_model.inp"
      ).trim(),
    };
  }

  return { updatedInpContent: null, updatedInpFileName: null };
}

export const handler = async (event: AskGpt6SolEvent) => {
  const startedAt = Date.now();
  const engineId = process.env.BEDROCK_ENGINE_ID || "anthropic.claude-opus-5";
  const profileId =
    process.env.BEDROCK_INFERENCE_PROFILE_ID || "us.anthropic.claude-opus-5";
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

  const effectiveSystemPrompt = buildSystemPromptWithInp(
    event.arguments.systemPrompt,
    event.arguments.inpContent,
    event.arguments.inpFileName
  );

  const hasImages = messages.some(
    (m) => m.attachments && m.attachments.length > 0
  );

  // Live AWS Bedrock: try Claude Opus 5 first (supports both TEXT and IMAGE), then multimodal/text fallbacks
  const candidateAttempts: Array<{ model: string; withImages: boolean }> =
    hasImages
      ? [
          { model: profileId, withImages: true },
          { model: "global.anthropic.claude-opus-5", withImages: true },
          { model: "anthropic.claude-opus-5", withImages: true },
          { model: "us.meta.llama4-maverick-17b-instruct-v1:0", withImages: true },
          { model: "us.amazon.nova-pro-v1:0", withImages: true },
          { model: "us.meta.llama4-scout-17b-instruct-v1:0", withImages: true },
          { model: "us.amazon.nova-2-lite-v1:0", withImages: true },
          { model: "us.amazon.nova-lite-v1:0", withImages: true },
        ]
      : [
          { model: profileId, withImages: false },
          { model: "global.anthropic.claude-opus-5", withImages: false },
          { model: "anthropic.claude-opus-5", withImages: false },
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
        effectiveSystemPrompt,
        event.arguments.temperature,
        attempt.withImages
      );

      const text =
        result.output?.message?.content
          ?.map((block) => block.text || "")
          .join("\n")
          .trim() || "No response text returned from Bedrock.";

      const { updatedInpContent, updatedInpFileName } =
        extractUpdatedInpFromReply(text, event.arguments.inpFileName);

      return {
        reply: text,
        modelId: engineId,
        inferenceProfileId: attempt.model,
        source: "aws-bedrock",
        latencyMs: Date.now() - startedAt,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        errorDetail: null,
        updatedInpContent,
        updatedInpFileName,
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
    updatedInpContent: null,
    updatedInpFileName: null,
  };
};

