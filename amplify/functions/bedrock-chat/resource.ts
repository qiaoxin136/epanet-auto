import { defineFunction } from "@aws-amplify/backend";

export const bedrockChat = defineFunction({
  name: "bedrock-chat",
  entry: "./handler.ts",
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    BEDROCK_ENGINE_ID: "openai.gpt-6-sol",
    BEDROCK_INFERENCE_PROFILE_ID: "us.openai.gpt-6-sol",
    BEDROCK_REGION: "us-east-2",
  },
});
