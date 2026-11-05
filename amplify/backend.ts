import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bedrockChat } from './functions/bedrock-chat/resource';

export const backend = defineBackend({
  auth,
  data,
  bedrockChat,
});

