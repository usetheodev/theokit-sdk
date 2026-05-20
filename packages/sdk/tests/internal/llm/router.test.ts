/**
 * Tests for refactored router (T4.3, ADRs D105-D107).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveProviderChain } from "../../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  registerProvider,
} from "../../../src/internal/providers/registry.js";

const ORIG_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  for (const k of [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_BASE_URL",
    "OPENAI_API_BASE_URL",
    "OPENROUTER_API_BASE_URL",
  ]) {
    ORIG_ENV[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

describe("router (T4.3)", () => {
  it("buildClient anthropic via profile", () => {
    process.env.ANTHROPIC_API_KEY = "k1";
    const chain = resolveProviderChain({ primary: "anthropic" });
    expect(chain).toHaveLength(1);
  });

  it("buildClient openrouter alias 'or'", () => {
    process.env.OPENROUTER_API_KEY = "k1";
    const chain = resolveProviderChain({ primary: "or" });
    expect(chain).toHaveLength(1);
  });

  it("buildClient user-overridden provider used", () => {
    registerBuiltins();
    registerProvider({
      name: "anthropic",
      apiMode: "anthropic_messages",
      envVars: ["MY_OVERRIDE_KEY"],
      authType: "api_key",
      baseUrl: "https://custom.anthropic-proxy.com",
      fallbackModels: ["claude-custom"],
    });
    process.env.MY_OVERRIDE_KEY = "ok";
    const chain = resolveProviderChain({ primary: "anthropic" });
    expect(chain).toHaveLength(1);
  });

  it("unknown provider throws helpful error", () => {
    expect(() => resolveProviderChain({ primary: "totally-unknown-provider" })).toThrow(
      /No provider client could be resolved/,
    );
  });

  it("EC-3: selectTransport unsupported apiMode throws transport_unavailable", () => {
    registerProvider({
      name: "bedrock-needs-transport",
      apiMode: "bedrock",
      envVars: ["AWS_ACCESS_KEY_ID"],
      authType: "aws_sdk",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      fallbackModels: ["anthropic.claude-3-haiku-20240307-v1:0"],
    });
    process.env.AWS_ACCESS_KEY_ID = "fake";
    expect(() => resolveProviderChain({ primary: "bedrock-needs-transport" })).toThrow(
      /transport plugin/,
    );
  });

  it("EC-10: envVars first match wins (only OPENAI_API_KEY set)", () => {
    // openrouter profile envVars: [OPENROUTER_API_KEY, OPENAI_API_KEY]
    process.env.OPENAI_API_KEY = "openai-key";
    const chain = resolveProviderChain({ primary: "openrouter" });
    // Resolved (key found via fallback in env list).
    expect(chain).toHaveLength(1);
  });
});
