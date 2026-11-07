import { defineFunction } from "@aws-amplify/backend";

export const bedrockChat = defineFunction({
  name: "bedrock-chat",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    BEDROCK_ENGINE_ID: "anthropic.claude-opus-5-5",
    BEDROCK_INFERENCE_PROFILE_ID: "us.anthropic.claude-opus-5-5",
    BEDROCK_REGION: "us-east-2",
  },
});
