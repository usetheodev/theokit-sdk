/**
 * B-098 — the four cloud-provider base-URL / organization overrides that had no test at all, and
 * B-097 — the assertion that pins ollama's routing so removing the unreachable `case "ollama"` from
 * `resolveBaseUrlEnvOverride` cannot silently change where an ollama request goes.
 *
 * Measured before writing this file, over the router + provider + cron slice of the default gate
 * (56 files / 425 tests, all green) with `--coverage.include='src/internal/llm/router.ts'`:
 *
 *   DA:200,2   case "openai"      -> reached, but no test observed the URL it returns
 *   DA:202,14  case "openrouter"  -> same
 *   DA:204,0   case "ollama"      -> NEVER executed (B-097: unreachable, removed in this batch)
 *   DA:390,0   opts.organization = process.env.OPENAI_ORGANIZATION -> never executed
 *   BRDA:389,49,1,2  the `OPENAI_ORGANIZATION !== undefined` operand was evaluated twice and never true
 *
 * Reaching a line is not constraining it (`testing.md` § 4.1 / § 4.2): `case "openai"` ran twice
 * with `OPENAI_API_BASE_URL` unset, so its return value was `undefined` both times and deleting the
 * arm changed nothing. Each test below is paired with its default-value sibling, so a mutant that
 * makes the guard fire ALWAYS dies as surely as one that makes it never fire.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetNoAuthApiKeyWarnings } from "../../../src/internal/llm/router.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  registerProvider,
} from "../../../src/internal/providers/registry.js";
import { ANTHROPIC_MESSAGES_SSE, captureRequest } from "../../helpers/capture-request.js";

const ORIG_ENV: Record<string, string | undefined> = {};
const TRACKED_ENV = [
  "OPENAI_API_BASE_URL",
  "OPENROUTER_API_BASE_URL",
  "ANTHROPIC_API_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OLLAMA_HOST",
  "OLLAMA_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

beforeEach(() => {
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
  _resetNoAuthApiKeyWarnings();
  for (const k of TRACKED_ENV) {
    ORIG_ENV[k] = process.env[k];
    delete process.env[k];
  }
  registerBuiltins();
});
afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetProvidersForTests();
  _resetBuiltinsRegistered();
});

describe("OPENAI_API_BASE_URL (B-098)", () => {
  it("test_an_openai_request_goes_to_the_public_api_when_no_override_is_set", async () => {
    const { url } = await captureRequest({ primary: "openai", apiKeys: { openai: ["sk-test"] } });

    expect(url, "the unconfigured default must stay the public OpenAI API").toMatch(
      /^https:\/\/api\.openai\.com\//,
    );
  });

  it("test_OPENAI_API_BASE_URL_points_openai_at_a_private_gateway", async () => {
    // What the user buys with this variable: an enterprise proxy / Azure-style gateway in front of
    // OpenAI. If the env read is deleted from `router.ts`, the request silently goes to the public
    // API instead — traffic leaving the perimeter, with nothing red.
    process.env.OPENAI_API_BASE_URL = "https://gateway.internal:8443";

    const { url } = await captureRequest({ primary: "openai", apiKeys: { openai: ["sk-test"] } });

    expect(url, "the request must go to the gateway OPENAI_API_BASE_URL names").toMatch(
      /^https:\/\/gateway\.internal:8443\//,
    );
  });
});

describe("OPENROUTER_API_BASE_URL (B-098)", () => {
  it("test_an_openrouter_request_goes_to_openrouter_when_no_override_is_set", async () => {
    const { url } = await captureRequest({
      primary: "openrouter",
      apiKeys: { openrouter: ["sk-or-test"] },
    });

    expect(url).toMatch(/^https:\/\/openrouter\.ai\/api\//);
  });

  it("test_OPENROUTER_API_BASE_URL_points_openrouter_at_a_private_gateway", async () => {
    process.env.OPENROUTER_API_BASE_URL = "https://or-proxy.internal";

    const { url } = await captureRequest({
      primary: "openrouter",
      apiKeys: { openrouter: ["sk-or-test"] },
    });

    expect(url, "the request must go to the gateway OPENROUTER_API_BASE_URL names").toMatch(
      /^https:\/\/or-proxy\.internal\//,
    );
  });
});

describe("ANTHROPIC_API_BASE_URL (B-098)", () => {
  // This one does not go through `resolveBaseUrlEnvOverride` at all — the `anthropic_messages` arm
  // reads the env var inline (`router.ts:416`). Same user-facing feature, different mechanism, and
  // it had no test either.
  it("test_an_anthropic_request_goes_to_the_public_api_when_no_override_is_set", async () => {
    // Documents the default a user gets, and NOTHING more. Stated because it is easy to mistake for
    // an oracle: `builtin/anthropic.ts:8` and the client's own fallback at `anthropic.ts:118` are
    // the same literal, so dropping `?? profile.baseUrl` from `router.ts` leaves this green. The
    // test below is the one that constrains that expression.
    const { url } = await captureRequest(
      { primary: "anthropic", apiKeys: { anthropic: ["sk-ant-test"] } },
      ANTHROPIC_MESSAGES_SSE,
    );

    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("test_an_anthropic_messages_profile_reaches_its_own_base_url_when_no_override_is_set", async () => {
    // The oracle the builtin cannot provide. A self-hosted Claude-compatible gateway registered as
    // a profile must be reached at ITS base URL — and because that URL differs from the client's
    // hardcoded fallback, deleting `?? profile.baseUrl` sends the request to api.anthropic.com and
    // this test goes red. The chat_completions arm gets the same protection for free from the
    // lmstudio / llamacpp profiles; `anthropic_messages` had no such sibling, which is why the
    // property was unconstrained until this row.
    registerProvider({
      name: "anthropic-mirror",
      apiMode: "anthropic_messages",
      envVars: [],
      authType: "api_key",
      baseUrl: "https://claude-mirror.internal",
      fallbackModels: ["anthropic-mirror/m"],
    });

    const { url } = await captureRequest(
      { primary: "anthropic-mirror", apiKeys: { "anthropic-mirror": ["sk-ant-test"] } },
      ANTHROPIC_MESSAGES_SSE,
    );

    expect(url, "the profile's own endpoint must be honoured, not the client's fallback").toBe(
      "https://claude-mirror.internal/v1/messages",
    );
  });

  it("test_ANTHROPIC_API_BASE_URL_points_anthropic_at_a_private_gateway", async () => {
    process.env.ANTHROPIC_API_BASE_URL = "https://claude-proxy.internal";

    const { url } = await captureRequest(
      { primary: "anthropic", apiKeys: { anthropic: ["sk-ant-test"] } },
      ANTHROPIC_MESSAGES_SSE,
    );

    expect(url, "the request must go to the gateway ANTHROPIC_API_BASE_URL names").toBe(
      "https://claude-proxy.internal/v1/messages",
    );
  });
});

describe("OPENAI_ORGANIZATION (B-098)", () => {
  it("test_OPENAI_ORGANIZATION_is_sent_as_the_openai_organization_header", async () => {
    // Asserted on the HEADER it sets, not on the base URL — this override bills the request to a
    // specific org. Losing it does not break the call, it bills the wrong account, which is exactly
    // the class of regression no smoke test notices.
    process.env.OPENAI_ORGANIZATION = "org-theokit-prod";

    const { headers } = await captureRequest({
      primary: "openai",
      apiKeys: { openai: ["sk-test"] },
    });

    expect(headers["openai-organization"]).toBe("org-theokit-prod");
  });

  it("test_no_organization_header_is_sent_when_OPENAI_ORGANIZATION_is_unset", async () => {
    const { headers } = await captureRequest({
      primary: "openai",
      apiKeys: { openai: ["sk-test"] },
    });

    expect(
      headers["openai-organization"],
      "an unset variable must not fabricate an org attribution",
    ).toBeUndefined();
  });

  it("test_the_organization_header_is_openai_only_and_does_not_leak_to_openrouter", async () => {
    // `router.ts:389` guards the read with `profile.name === "openai"`. Without that clause the
    // header would ride along to every chat-completions provider, leaking an internal org id to a
    // third party.
    process.env.OPENAI_ORGANIZATION = "org-theokit-prod";

    const { headers } = await captureRequest({
      primary: "openrouter",
      apiKeys: { openrouter: ["sk-or-test"] },
    });

    expect(headers["openai-organization"]).toBeUndefined();
  });
});

describe("ollama routing (B-097)", () => {
  it("test_ollama_is_served_by_the_native_client_not_the_openai_compat_transport", async () => {
    // The routing fact that made `case "ollama"` in `resolveBaseUrlEnvOverride` dead code:
    // `router.ts:372` returns `OllamaNativeClient` before the compat branch ever calls the switch.
    // `/api/chat` is Ollama's NATIVE endpoint; the compat client would request
    // `/v1/chat/completions`. Pinning the path is what makes removing the unreachable arm safe —
    // if a future change routed ollama through the compat transport, this test goes red rather
    // than the override quietly reverting to whatever the profile's default is.
    const { url, name } = await captureRequest({ primary: "ollama" });

    expect(name, "ollama must resolve its own transport, not the compat one").toBe("ollama");
    expect(url).toBe("http://localhost:11434/api/chat");
  });

  it("test_OLLAMA_HOST_is_honoured_on_the_native_path", async () => {
    // The variable users actually set. It is read at `router.ts:373`, inside the native branch —
    // NOT by the switch arm this batch removes.
    process.env.OLLAMA_HOST = "http://192.168.1.50:11434";

    const { url } = await captureRequest({ primary: "ollama" });

    expect(url).toBe("http://192.168.1.50:11434/api/chat");
  });
});
