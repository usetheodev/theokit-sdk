/**
 * Bedrock profile tests — model id parsing, region inference, prefix strip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BEDROCK,
  inferRegionFromModelId,
  resolveBedrockBaseUrl,
  stripBedrockPrefix,
} from "../../src/internal/providers/builtin/bedrock.js";

const originalAwsRegion = process.env.AWS_REGION;

beforeEach(() => {
  delete process.env.AWS_REGION;
});
afterEach(() => {
  if (originalAwsRegion !== undefined) process.env.AWS_REGION = originalAwsRegion;
  else delete process.env.AWS_REGION;
});

describe("BEDROCK profile shape", () => {
  it("uses bedrock_anthropic apiMode + aws_bearer authType", () => {
    expect(BEDROCK.apiMode).toBe("bedrock_anthropic");
    expect(BEDROCK.authType).toBe("aws_bearer");
  });

  it("reads AWS_BEARER_TOKEN_BEDROCK env var", () => {
    expect(BEDROCK.envVars).toEqual(["AWS_BEARER_TOKEN_BEDROCK"]);
  });

  it("fallback models follow bedrock/<aws-id> convention (EC-13)", () => {
    for (const m of BEDROCK.fallbackModels) {
      expect(m.startsWith("bedrock/")).toBe(true);
    }
  });
});

describe("stripBedrockPrefix", () => {
  it("strips leading bedrock/", () => {
    expect(stripBedrockPrefix("bedrock/us.anthropic.claude-sonnet-4-5-v1:0")).toBe(
      "us.anthropic.claude-sonnet-4-5-v1:0",
    );
  });

  it("returns unchanged when no prefix", () => {
    expect(stripBedrockPrefix("us.anthropic.foo")).toBe("us.anthropic.foo");
  });
});

describe("inferRegionFromModelId", () => {
  it("us. prefix uses AWS_REGION when set", () => {
    process.env.AWS_REGION = "us-west-2";
    expect(inferRegionFromModelId("bedrock/us.anthropic.foo")).toBe("us-west-2");
  });

  it("us. prefix defaults to us-east-1 when AWS_REGION unset", () => {
    expect(inferRegionFromModelId("bedrock/us.anthropic.foo")).toBe("us-east-1");
  });

  it("eu. prefix defaults to eu-west-1", () => {
    expect(inferRegionFromModelId("bedrock/eu.anthropic.foo")).toBe("eu-west-1");
  });

  it("apac. prefix defaults to ap-southeast-1", () => {
    expect(inferRegionFromModelId("bedrock/apac.anthropic.foo")).toBe("ap-southeast-1");
  });

  it("jp. prefix hardcodes ap-northeast-1", () => {
    process.env.AWS_REGION = "us-east-1"; // should be ignored
    expect(inferRegionFromModelId("bedrock/jp.anthropic.foo")).toBe("ap-northeast-1");
  });

  it("global. prefix routes us-east-1", () => {
    expect(inferRegionFromModelId("bedrock/global.anthropic.foo")).toBe("us-east-1");
  });

  it("no prefix returns undefined", () => {
    expect(inferRegionFromModelId("bedrock/anthropic.foo")).toBeUndefined();
  });
});

describe("resolveBedrockBaseUrl", () => {
  it("uses inferred region", () => {
    expect(resolveBedrockBaseUrl("bedrock/eu.anthropic.foo")).toBe(
      "https://bedrock-runtime.eu-west-1.amazonaws.com",
    );
  });

  it("falls back to AWS_REGION when no prefix", () => {
    process.env.AWS_REGION = "us-west-2";
    expect(resolveBedrockBaseUrl("bedrock/anthropic.foo")).toBe(
      "https://bedrock-runtime.us-west-2.amazonaws.com",
    );
  });

  it("ultimate default is us-east-1", () => {
    expect(resolveBedrockBaseUrl("bedrock/anthropic.foo")).toBe(
      "https://bedrock-runtime.us-east-1.amazonaws.com",
    );
  });
});
