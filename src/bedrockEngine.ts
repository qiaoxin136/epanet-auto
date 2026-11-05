import { generateClient } from "aws-amplify/data";
import outputs from "../amplify_outputs.json";

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

export type ExecutionMode = "auto" | "simulated" | "bedrock";

export interface ChatImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  attachments?: ChatImageAttachment[];
  modelId?: string;
  inferenceProfileId?: string;
  source?: "aws-bedrock" | "simulated" | "simulated-fallback" | "bedrock-error";
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
  source: "aws-bedrock" | "simulated" | "simulated-fallback" | "bedrock-error";
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

function tryEvaluateMath(input: string): string | null {
  const cleaned = input
    .replace(/what is|calculate|compute|solve|equals|\?/gi, "")
    .trim();
  if (!/^[\d\s+\-*/().%^]+$/.test(cleaned) || !/\d/.test(cleaned)) {
    return null;
  }
  try {
    const normalized = cleaned.replace(/\^/g, "**");
    const result = Function(`"use strict"; return (${normalized});`)();
    if (typeof result === "number" && Number.isFinite(result)) {
      return `**Result:** \`${cleaned} = ${Number(result.toFixed(6))}\`\n\nCalculated directly using standard operator precedence.`;
    }
  } catch {
    return null;
  }
  return null;
}

function craftSimulatedGpt6SolResponse(
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    attachments?: ChatImageAttachment[];
  }>,
  systemPrompt: string,
  temperature: number
): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastUserObj = userMessages[userMessages.length - 1];
  const lastUserMessage = lastUserObj?.content.trim() || "";
  const lastAttachments = lastUserObj?.attachments || [];
  const prevAssistantMessage =
    [...messages].reverse().find((m) => m.role === "assistant")?.content || "";
  const lower = lastUserMessage.toLowerCase();

  if (lastAttachments.length > 0) {
    const attachmentSummary = lastAttachments
      .map((img) => {
        const kb = (img.sizeBytes / 1024).toFixed(1);
        const dims =
          img.width && img.height ? `, \`${img.width}×${img.height}px\`` : "";
        return `- **\`${img.name}\`** (\`${img.mimeType}\`, \`${kb} KB\`${dims})`;
      })
      .join("\n");

    return [
      `### 🖼️ Multimodal Vision Analysis (\`openai.gpt-6-sol\`)`,
      "",
      `I received **${lastAttachments.length} picture file${
        lastAttachments.length > 1 ? "s" : ""
      }** in the conversation window:`,
      attachmentSummary,
      "",
      lastUserMessage
        ? `#### Prompt Context\n> "${lastUserMessage}"\n`
        : "",
      "#### Visual Inspection & Hydraulic / Technical Observations",
      "1. **Image Ingestion:** Picture decoded and inspected by `openai.gpt-6-sol` vision pipeline.",
      "2. **Water System & GIS Correlation:** If this image shows a water network map, schematic, tank/pump curve, or DEM terrain view, you can pair it with the **Right-Hand `build-epanet` Panel** by uploading the matching `pipe.json`, `tank.json`, `pump.json`, `water-demand.json`, and `pressure-zone.json` files.",
      "3. **Next Steps:** Click **🔍 Audit** on the right panel to verify missing components or ask me to extract parameters (pipe diameters, tank elevations, or pump head curves) from this image!",
    ]
      .filter(Boolean)
      .join("\n");
  }

  let rememberedName: string | null = null;
  for (const msg of userMessages) {
    const match = msg.content.match(/(?:my name is|i am|call me)\s+([A-Z][a-zA-Z0-9_-]{1,20})/i);
    if (match) {
      rememberedName = match[1];
    }
  }

  const mathAnswer = tryEvaluateMath(lastUserMessage);
  if (mathAnswer) {
    return mathAnswer;
  }

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|greetings)\b/i.test(lower)) {
    return [
      `Hello${rememberedName ? `, **${rememberedName}**` : ""}! I'm **GPT-6 Sol** (\`openai.gpt-6-sol\`), running on your AWS Amplify + Amazon Bedrock conversational interface.`,
      "",
      "How can I help you today? You can ask me to:",
      "- Write or debug **TypeScript, React, Python, or AWS Amplify** code",
      "- Design **AWS Bedrock** architectures and GraphQL schemas",
      "- Analyze **EPANET hydraulic models**, pipe networks, and pump curves",
      "- Draft technical summaries, SQL queries, or system designs",
    ].join("\n");
  }

  if (
    lower.includes("what model") ||
    lower.includes("which model") ||
    lower.includes("who are you") ||
    lower.includes("bedrock engine")
  ) {
    return [
      "I am **OpenAI GPT-6 Sol** configured via **Amazon Bedrock**.",
      "",
      "| Parameter | Value |",
      "| --- | --- |",
      "| **Engine Name** | OpenAI GPT-6 Sol |",
      "| **Bedrock Model ID** | `openai.gpt-6-sol` |",
      "| **US Inference Profile** | `us.openai.gpt-6-sol` |",
      "| **Global Inference Profile** | `global.openai.gpt-6-sol` |",
      "| **AWS Region** | `us-east-2` |",
      `| **Temperature** | \`${temperature.toFixed(2)}\` |`,
      "",
      "This app uses AWS Amplify Gen 2 (`defineData` + `defineFunction`) to route conversational turns to Bedrock's Converse API, with instant simulated streaming for local prototyping.",
    ].join("\n");
  }

  if (lower.includes("my name")) {
    if (rememberedName) {
      return `Your name is **${rememberedName}** based on our earlier conversation in this thread.`;
    }
    return "You haven't mentioned your name in this conversation yet! Tell me *\"My name is ...\"* and I'll remember it across turns.";
  }

  if (
    (lower.includes("shorter") ||
      lower.includes("summarize") ||
      lower.includes("tl;dr") ||
      lower.includes("concise")) &&
    prevAssistantMessage
  ) {
    const firstLines = prevAssistantMessage
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.startsWith("```"))
      .slice(0, 3)
      .map((line) => `- ${line.replace(/^[-*#>\d.\s]+/, "")}`)
      .join("\n");
    return [
      "### Concise Summary (TL;DR)",
      firstLines || "- Focused on the core actionable points from the previous response.",
      "",
      "_Condensed from the previous turn by `openai.gpt-6-sol`._",
    ].join("\n");
  }

  if (
    lower.includes("epanet") ||
    lower.includes("hydraulic") ||
    lower.includes("pipe") ||
    lower.includes("pump") ||
    lower.includes("pressure")
  ) {
    return [
      "### Hydraulic & EPANET Network Analysis (`openai.gpt-6-sol`)",
      "",
      `For your query regarding **"${lastUserMessage}"**, here is a structured engineering breakdown:`,
      "",
      "1. **Headloss Formulation (Hazen-Williams):**",
      "   `hf = 10.67 * L * Q^1.852 * C^-1.852 * D^-4.8704`",
      "   - Ensure roughness coefficients (`C`-factors) reflect pipe material and age (e.g., `C = 130` for new ductile iron/PVC, `C = 80–100` for unlined cast iron).",
      "2. **Pressure & Velocity Design Criteria:**",
      "   - **Normal Operating Pressure:** `35 – 80 psi` (`240 – 550 kPa`)",
      "   - **Minimum Fire Flow Pressure:** `20 psi` (`140 kPa`)",
      "   - **Target Pipe Velocity:** `2.0 – 5.0 ft/s` (avoid `> 8 ft/s` to mitigate water hammer).",
      "",
      "```ini",
      "[JUNCTIONS]",
      ";ID      Elev      Demand    Pattern",
      " J-101   412.5     85.0      PAT_RES",
      " J-102   398.0     120.0     PAT_COM",
      "",
      "[PIPES]",
      ";ID      Node1     Node2     Length    Diameter  Roughness Status",
      " P-201   J-101     J-102     1250.0    12.0      130       Open",
      "```",
      "",
      "Would you like me to generate a Python `wntr` / `epyt` script or check specific boundary conditions?",
    ].join("\n");
  }

  if (
    lower.includes("code") ||
    lower.includes("react") ||
    lower.includes("typescript") ||
    lower.includes("python") ||
    lower.includes("lambda") ||
    lower.includes("bedrock") ||
    lower.includes("amplify") ||
    lower.includes("function") ||
    lower.includes("script")
  ) {
    const wantsPython = lower.includes("python") || lower.includes("boto3");
    if (wantsPython) {
      return [
        "Here is a clean **Python (`boto3`)** example for invoking `openai.gpt-6-sol` using the Amazon Bedrock Converse API:",
        "",
        "```python",
        "import boto3",
        "",
        "client = boto3.client('bedrock-runtime', region_name='us-east-2')",
        "",
        "def ask_gpt6_sol(prompt: str, system_prompt: str = 'You are a helpful assistant.') -> str:",
        "    response = client.converse(",
        "        modelId='us.openai.gpt-6-sol',",
        "        system=[{'text': system_prompt}],",
        "        messages=[",
        "            {",
        "                'role': 'user',",
        "                'content': [{'text': prompt}],",
        "            }",
        "        ],",
        "        inferenceConfig={",
        "            'temperature': 0.7,",
        "            'maxTokens': 1024,",
        "        },",
        "    )",
        "    return response['output']['message']['content'][0]['text']",
        "",
        "if __name__ == '__main__':",
        "    print(ask_gpt6_sol('Explain event-driven architecture in 3 bullet points.'))",
        "```",
        "",
        "### Key Details",
        "- Uses the **`us.openai.gpt-6-sol`** cross-region inference profile for high availability.",
        "- Supports multi-turn `messages` arrays, tool use (`toolConfig`), and `converse_stream` for streaming responses.",
      ].join("\n");
    }

    return [
      "Here is a **TypeScript + AWS Amplify Gen 2** pattern for querying `openai.gpt-6-sol` on Amazon Bedrock:",
      "",
      "```typescript",
      "import { generateClient } from 'aws-amplify/data';",
      "import type { Schema } from '../amplify/data/resource';",
      "",
      "const client = generateClient<Schema>();",
      "",
      "export async function queryGpt6Sol(prompt: string) {",
      "  const { data, errors } = await client.queries.askGpt6Sol({",
      "    messagesJson: JSON.stringify([{ role: 'user', content: prompt }]),",
      "    systemPrompt: 'You are a concise technical assistant.',",
      "    temperature: 0.7,",
      "    mode: 'auto',",
      "  });",
      "",
      "  if (errors?.length) {",
      "    throw new Error(errors.map((e) => e.message).join('; '));",
      "  }",
      "  return data;",
      "}",
      "```",
      "",
      "### How It Works",
      "1. **Frontend:** Sends the conversation history via AppSync (`client.queries.askGpt6Sol`).",
      "2. **Amplify Function (`amplify/functions/bedrock-chat`):** Signs the request with AWS SigV4 and invokes Bedrock's `/model/us.openai.gpt-6-sol/converse` endpoint.",
      "3. **Automatic Fallback:** If the sandbox isn't deployed yet, the UI seamlessly streams a simulated response.",
    ].join("\n");
  }

  if (lower.includes("sql") || lower.includes("database") || lower.includes("query")) {
    return [
      "Here is an optimized SQL query pattern with window functions and indexing recommendations:",
      "",
      "```sql",
      "WITH ranked_events AS (",
      "  SELECT",
      "    asset_id,",
      "    recorded_at,",
      "    pressure_psi,",
      "    flow_gpm,",
      "    AVG(pressure_psi) OVER (",
      "      PARTITION BY asset_id",
      "      ORDER BY recorded_at",
      "      ROWS BETWEEN 5 PRECEDING AND CURRENT ROW",
      "    ) AS rolling_avg_pressure",
      "  FROM telemetry_readings",
      "  WHERE recorded_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'",
      ")",
      "SELECT *",
      "FROM ranked_events",
      "WHERE pressure_psi < 35.0",
      "ORDER BY recorded_at DESC;",
      "```",
      "",
      "- **Performance Tip:** Add a composite index on `(asset_id, recorded_at DESC)` to avoid full-table scans on time-windowed queries.",
    ].join("\n");
  }

  const cleanTopic = lastUserMessage.replace(/\?+$/, "").trim();
  const turnNumber = userMessages.length;

  return [
    `### Response to: "${cleanTopic.length > 72 ? cleanTopic.slice(0, 72) + "..." : cleanTopic}"`,
    "",
    `Here is a structured analysis from **GPT-6 Sol (\`openai.gpt-6-sol\`)**${turnNumber > 1 ? ` (Turn #${turnNumber} in this conversation)` : ""}:`,
    "",
    "#### 1. Core Overview",
    `- **Primary Objective:** Address _"${cleanTopic}"_ with clear, practical, and verifiable steps.`,
    `- **Engine Configuration:** Running on \`openai.gpt-6-sol\` via inference profile \`us.openai.gpt-6-sol\` (temperature \`${temperature.toFixed(2)}\`).`,
    systemPrompt.trim()
      ? `- **System Persona:** Guided by your active system instruction (_"${systemPrompt.trim().slice(0, 90)}${systemPrompt.trim().length > 90 ? "..." : ""}"_).`
      : "- **Conversational Memory:** Full multi-turn message history is preserved across this thread.",
    "",
    "#### 2. Recommended Approach",
    "1. **Define Inputs & Constraints:** Clarify the target inputs, expected output schema, and latency budget.",
    "2. **Iterative Execution:** Validate behavior in **Simulated Bedrock Mode** first, then switch to **Live AWS Bedrock** once `npx ampx sandbox` is running.",
    "3. **Refine & Follow Up:** Ask me to expand any section, generate code in a specific language, or summarize this into a table.",
    "",
    "Would you like me to dive deeper into a specific part of this or generate working code for it?",
  ].join("\n");
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

export async function queryBedrockGpt6Sol(
  options: BedrockQueryOptions
): Promise<BedrockQueryResult> {
  const startedAt = performance.now();
  const { messages, systemPrompt, temperature, mode, signal, onToken } = options;

  const canTryBackend = mode !== "simulated" && isAmplifyBackendConfigured();

  if (canTryBackend) {
    try {
      const client = generateClient() as unknown as AskGpt6SolClient;
      const { data, errors } = await client.queries.askGpt6Sol({
        messagesJson: JSON.stringify(messages),
        systemPrompt,
        temperature,
        mode,
      });

      if (errors?.length) {
        throw new Error(errors.map((e) => e.message).join("; "));
      }

      if (data) {
        const finalText = await streamTextToCallback(data.reply, onToken, signal);
        return {
          reply: finalText,
          modelId: data.modelId || BEDROCK_ENGINE_CONFIG.modelId,
          inferenceProfileId:
            data.inferenceProfileId || BEDROCK_ENGINE_CONFIG.inferenceProfileId,
          source:
            (data.source as BedrockQueryResult["source"]) || "aws-bedrock",
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
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (mode === "bedrock") {
        const errorReply = [
          "### AWS Bedrock Connection Notice",
          `Attempted live call to \`${BEDROCK_ENGINE_CONFIG.modelId}\` (\`${BEDROCK_ENGINE_CONFIG.inferenceProfileId}\`), but received:`,
          "",
          `\`\`\`\n${errMsg}\n\`\`\``,
          "",
          "**Tip:** Switch the mode selector in the sidebar to **Auto** or **Simulated** to test conversations while your AWS Bedrock account verification or `npx ampx sandbox` deployment completes.",
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
  } else if (mode === "bedrock" && !isAmplifyBackendConfigured()) {
    const noticeReply = [
      "### Amplify Sandbox Not Connected Yet",
      `You selected **Live AWS Bedrock** mode for \`${BEDROCK_ENGINE_CONFIG.modelId}\`, but \`amplify_outputs.json\` is currently using local placeholder values.`,
      "",
      "To connect live to AWS Bedrock:",
      "1. Run `npx ampx sandbox` in your project root (`D:\\AI\\agent\\epanet-auto`).",
      "2. Ensure your AWS account Bedrock verification is complete for `us.openai.gpt-6-sol`.",
      "",
      "Or switch the mode toggle to **Auto** / **Simulated** to use the interactive simulated GPT-6 Sol engine immediately.",
    ].join("\n");
    const streamed = await streamTextToCallback(noticeReply, onToken, signal);
    return {
      reply: streamed,
      modelId: BEDROCK_ENGINE_CONFIG.modelId,
      inferenceProfileId: BEDROCK_ENGINE_CONFIG.inferenceProfileId,
      source: "bedrock-error",
      latencyMs: Math.round(performance.now() - startedAt),
      promptTokens: estimateTokens(JSON.stringify(messages)),
      completionTokens: estimateTokens(streamed),
      errorDetail: "Amplify sandbox endpoint not configured in amplify_outputs.json",
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 220));
  const rawReply = craftSimulatedGpt6SolResponse(messages, systemPrompt, temperature);
  const streamedReply = await streamTextToCallback(rawReply, onToken, signal);
  const elapsedMs = Math.round(performance.now() - startedAt);

  return {
    reply: streamedReply,
    modelId: BEDROCK_ENGINE_CONFIG.modelId,
    inferenceProfileId: BEDROCK_ENGINE_CONFIG.inferenceProfileId,
    source: mode === "auto" ? "simulated-fallback" : "simulated",
    latencyMs: elapsedMs,
    promptTokens: estimateTokens(
      messages.map((m) => m.content).join(" ") + " " + systemPrompt
    ),
    completionTokens: estimateTokens(streamedReply),
    errorDetail: null,
  };
}
