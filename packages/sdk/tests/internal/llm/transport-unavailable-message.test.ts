/**
 * The error a user hits when no transport matches must not send them after a package that cannot exist.
 *
 * `selectTransport` ends in a `ConfigurationError` that read: *"Install a third-party transport
 * plugin (`@theokit-transport-{apiMode}`) or use a provider with apiMode chat_completions or
 * anthropic_messages."* There is no transport plugin mechanism. `registerTransport` and
 * `transportRegistry` return ZERO hits across `src/`, and the only two occurrences of the string
 * `theokit-transport` in the package are that message and a docblock describing it. A publisher
 * could write the package; nothing would ever load it.
 *
 * This is not a comment nobody reads — it is the text a consumer sees at the moment they are
 * blocked, and it costs them a search for a package, then a search for the plugin API, before they
 * conclude the SDK is wrong rather than their configuration.
 *
 * The message now names the four apiModes that actually have a transport arm. It is not a smaller
 * promise; it is the true one.
 */
import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { resolveProviderChain } from "../../../src/internal/llm/router.js";
import { registerProvider } from "../../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../../src/types/provider-profile.js";

/**
 * `bedrock` is a declared ApiMode with NO arm in `selectTransport` (it handles chat_completions,
 * anthropic_messages, bedrock_anthropic and responses_api), so a provider carrying it always falls
 * through to the error. Reached through the exported `resolveProviderChain` rather than by exporting
 * the private `selectTransport`: the message is what a consumer meets, so the test should arrive the
 * way they do.
 *
 * Latent rather than live today: the one catalog entry with `apiMode: "bedrock"` is `bedrock`, and
 * the TypeScript builtin overrides it with `bedrock_anthropic`. Delete that builtin — the mutation
 * `builtin-wins-over-catalog.test.ts` guards against — and this dead end becomes reachable.
 */
const UNSUPPORTED: ProviderProfile = {
  name: "probe-unsupported-apimode",
  apiMode: "bedrock",
  authType: "api_key",
  baseUrl: "https://example.test",
  envVars: ["PROBE_KEY"],
} as unknown as ProviderProfile;

function messageFor(profile: ProviderProfile): string {
  registerProvider(profile);
  try {
    resolveProviderChain({ primary: profile.name, apiKeys: { [profile.name]: ["k"] } });
  } catch (err) {
    if (err instanceof ConfigurationError) return err.message;
    throw err;
  }
  throw new Error("resolveProviderChain did not reject an unsupported apiMode");
}

describe("the transport-unavailable error", () => {
  it("does not advertise a plugin package that cannot be loaded", () => {
    const message = messageFor(UNSUPPORTED);
    expect(
      message,
      "no registerTransport / transportRegistry exists, so a `@theokit-transport-*` package has " +
        "nothing to plug into — naming it sends the reader to look for an API that is not there",
    ).not.toContain("theokit-transport");
  });

  it("names every apiMode that actually has a transport", () => {
    const message = messageFor(UNSUPPORTED);
    for (const supported of [
      "chat_completions",
      "anthropic_messages",
      "bedrock_anthropic",
      "responses_api",
    ]) {
      expect(message, `the message must name the supported mode "${supported}"`).toContain(
        supported,
      );
    }
  });

  it("still names the apiMode that failed, and keeps its stable code", () => {
    const message = messageFor(UNSUPPORTED);
    expect(message).toContain("bedrock");
    expect(message).toContain("probe-unsupported-apimode");
  });
});
