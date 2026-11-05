import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bedrockChat } from './functions/bedrock-chat/resource';

export const backend = defineBackend({
  auth,
  data,
  bedrockChat,
});

backend.bedrockChat.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      'bedrock:InvokeModel',
      'bedrock:InvokeModelWithResponseStream',
      'bedrock:GetInferenceProfile',
      'bedrock:ListInferenceProfiles',
      'bedrock:GetFoundationModel',
      'bedrock:ListFoundationModels',
      'aws-marketplace:ViewSubscriptions',
      'aws-marketplace:Subscribe',
    ],
    resources: [
      'arn:aws:bedrock:*::foundation-model/*',
      'arn:aws:bedrock:*:*:inference-profile/*',
      'arn:aws:bedrock:*:*:application-inference-profile/*',
      '*',
    ],
  })
);


