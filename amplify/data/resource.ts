import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { bedrockChat } from "../functions/bedrock-chat/resource";

const schema = a.schema({
  Todo: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()]),

  BedrockChatResponse: a.customType({
    reply: a.string().required(),
    modelId: a.string().required(),
    inferenceProfileId: a.string().required(),
    source: a.string().required(),
    latencyMs: a.integer(),
    promptTokens: a.integer(),
    completionTokens: a.integer(),
    errorDetail: a.string(),
  }),

  askGpt6Sol: a
    .query()
    .arguments({
      messagesJson: a.string().required(),
      systemPrompt: a.string(),
      temperature: a.float(),
      mode: a.string(),
    })
    .returns(a.ref("BedrockChatResponse"))
    .authorization((allow) => [allow.authenticated(), allow.publicApiKey()])
    .handler(a.handler.function(bedrockChat)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "apiKey",
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});

