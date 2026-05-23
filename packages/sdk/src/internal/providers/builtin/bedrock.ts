/**
 * AWS Bedrock profile (Adoption Roadmap #8; ADRs D286-D302).
 *
 * Bearer-only auth via `AWS_BEARER_TOKEN_BEDROCK` env (GA Sep 2025).
 * Optional `@aws/bedrock-token-generator` peer dep auto-refreshes short-term
 * tokens (D287). Transport via native `fetch`; no `@aws-sdk/*` dependency.
 *
 * Model IDs follow the `bedrock/{aws-id}` convention so the router can
 * infer the provider via prefix routing (D186). The client strips the
 * `bedrock/` prefix before building the URL.
 *
 * @internal
 */

import type { ProviderProfile } from "../types.js";

export const BEDROCK: ProviderProfile = {
  name: "bedrock",
  apiMode: "bedrock_anthropic",
  envVars: ["AWS_BEARER_TOKEN_BEDROCK"],
  authType: "aws_bearer",
  baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
  modelsUrl: undefined,
  hostname: "bedrock-runtime.amazonaws.com",
  fallbackModels: [
    "bedrock/us.anthropic.claude-sonnet-4-5-v1:0",
    "bedrock/us.anthropic.claude-opus-4-7-v1:0",
    "bedrock/global.anthropic.claude-haiku-4-5-v1:0",
  ],
};

/** Strip `"bedrock/"` prefix so the raw AWS model id is used in the URL. */
export function stripBedrockPrefix(modelId: string): string {
  return modelId.replace(/^bedrock\//, "");
}

/**
 * Infer AWS region from a Bedrock model id prefix (D290).
 *
 * `global.*` routes via `us-east-1` (AWS default entrypoint for global
 * inference profiles).
 */
export function inferRegionFromModelId(modelId: string): string | undefined {
  const id = stripBedrockPrefix(modelId);
  if (id.startsWith("global.")) return "us-east-1";
  if (id.startsWith("us.")) return process.env.AWS_REGION ?? "us-east-1";
  if (id.startsWith("eu.")) return process.env.AWS_REGION ?? "eu-west-1";
  if (id.startsWith("apac.")) return process.env.AWS_REGION ?? "ap-southeast-1";
  if (id.startsWith("jp.")) return "ap-northeast-1";
  return undefined;
}

/** Resolve baseUrl from model id; falls back to `AWS_REGION` env or `us-east-1`. */
export function resolveBedrockBaseUrl(modelId: string): string {
  const region = inferRegionFromModelId(modelId) ?? process.env.AWS_REGION ?? "us-east-1";
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}
