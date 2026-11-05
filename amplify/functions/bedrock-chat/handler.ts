import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Hash } from "@smithy/hash-node";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

declare const process: { env: Record<string, string | undefined> };

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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

function buildSimulatedReply(messages: ChatTurn[], systemPrompt?: string | null): string {
  const lastUserMsg =
    [...messages].reverse().find((m) => m.role === "user")?.content.trim() || "";
  const lower = lastUserMsg.toLowerCase();

  if (!lastUserMsg) {
    return "Hello! I'm running on **openai.gpt-6-sol** via AWS Bedrock. How can I help you today?";
  }

  if (lower.includes("hello") || lower.includes("hi ") || lower === "hi") {
    return "Hello! I'm **GPT-6 Sol** (`openai.gpt-6-sol`) hosted on AWS Bedrock. Ask me anything—from coding and architecture to data analysis or hydraulic modeling.";
  }

  if (lower.includes("model") || lower.includes("who are you") || lower.includes("engine")) {
    return [
      "I am **OpenAI GPT-6 Sol** (`openai.gpt-6-sol`), invoked via AWS Bedrock (`us.openai.gpt-6-sol`).",
      "",
      "- **Provider:** OpenAI on Amazon Bedrock",
      "- **Model ID:** `openai.gpt-6-sol`",
      "- **Inference Profile:** `us.openai.gpt-6-sol`",
      "- **Streaming & Converse API:** Supported",
    ].join("\n");
  }

  return [
    `Here is a synthesized response from **openai.gpt-6-sol** for your query:`,
    "",
    `> "${lastUserMsg}"`,
    "",
    "### Key Takeaways",
    "1. **Direct Answer:** Your request has been processed through the conversational pipeline.",
    "2. **Engine Context:** Configured with AWS Bedrock `openai.gpt-6-sol` (`us.openai.gpt-6-sol`).",
    systemPrompt
      ? `3. **Active System Instruction:** _${systemPrompt}_`
      : "3. **Next Steps:** Feel free to ask follow-up questions, paste code snippets, or refine the constraints.",
  ].join("\n");
}

async function invokeBedrockConverse(
  region: string,
  modelOrProfileId: string,
  messages: ChatTurn[],
  systemPrompt?: string | null,
  temperature?: number | null
): Promise<BedrockConverseResponse> {
  const hostname = `bedrock-runtime.${region}.amazonaws.com`;
  const path = `/model/${encodeURIComponent(modelOrProfileId)}/converse`;

  const bodyObj: Record<string, unknown> = {
    messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ text: m.content }],
    })),
    inferenceConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.7,
      maxTokens: 2048,
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
  const profileId = process.env.BEDROCK_INFERENCE_PROFILE_ID || "us.openai.gpt-6-sol";
  const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-2";

  let messages: ChatTurn[] = [];
  try {
    messages = JSON.parse(event.arguments.messagesJson || "[]");
  } catch {
    messages = [{ role: "user", content: String(event.arguments.messagesJson || "") }];
  }

  const mode = event.arguments.mode || "auto";

  if (mode !== "simulated") {
    try {
      const result = await invokeBedrockConverse(
        region,
        profileId,
        messages,
        event.arguments.systemPrompt,
        event.arguments.temperature
      );

      const text =
        result.output?.message?.content
          ?.map((block) => block.text || "")
          .join("\n")
          .trim() || "No response text returned from Bedrock.";

      return {
        reply: text,
        modelId: engineId,
        inferenceProfileId: profileId,
        source: "aws-bedrock",
        latencyMs: Date.now() - startedAt,
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
        errorDetail: null,
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      if (mode === "bedrock") {
        return {
          reply: `AWS Bedrock invocation error for \`${engineId}\`: ${errMessage}`,
          modelId: engineId,
          inferenceProfileId: profileId,
          source: "bedrock-error",
          latencyMs: Date.now() - startedAt,
          promptTokens: 0,
          completionTokens: 0,
          errorDetail: errMessage,
        };
      }
      const fallbackReply = buildSimulatedReply(messages, event.arguments.systemPrompt);
      return {
        reply: fallbackReply,
        modelId: engineId,
        inferenceProfileId: profileId,
        source: "simulated-fallback",
        latencyMs: Date.now() - startedAt,
        promptTokens: Math.ceil(JSON.stringify(messages).length / 4),
        completionTokens: Math.ceil(fallbackReply.length / 4),
        errorDetail: errMessage,
      };
    }
  }

  const simulatedReply = buildSimulatedReply(messages, event.arguments.systemPrompt);
  return {
    reply: simulatedReply,
    modelId: engineId,
    inferenceProfileId: profileId,
    source: "simulated",
    latencyMs: Date.now() - startedAt,
    promptTokens: Math.ceil(JSON.stringify(messages).length / 4),
    completionTokens: Math.ceil(simulatedReply.length / 4),
    errorDetail: null,
  };
};
