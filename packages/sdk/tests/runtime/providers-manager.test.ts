import { describe, expect, it } from "vitest";
import { ProvidersManagerImpl } from "../../src/internal/runtime/config/providers-manager.js";
import type { ModelSelection } from "../../src/types/agent.js";
import type { ProviderRoutingSettings } from "../../src/types/providers.js";

/**
 * `ProvidersManagerImpl` answers "which provider serves which capability?" — the
 * inspector users call to understand routing before a run costs them money. Its
 * whole behaviour is the `reason` it attaches to each route, and every reason is
 * reachable only through a different combination of model id, routes and plugins.
 */
const model = (id: string): ModelSelection => ({ id }) as ModelSelection;

const routing = (routes: ProviderRoutingSettings["routes"]): ProviderRoutingSettings =>
  ({ routes }) as ProviderRoutingSettings;

describe("ProvidersManagerImpl — no routes configured", () => {
  it("resolves to an empty list when providers are undefined", async () => {
    const mgr = new ProvidersManagerImpl(model("anthropic:claude"), undefined, undefined);

    await expect(mgr.routes()).resolves.toEqual([]);
  });

  it("resolves to an empty list when routes are undefined", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude"),
      {} as ProviderRoutingSettings,
      [
        // biome-ignore lint/suspicious/noExplicitAny: plugin shape is irrelevant here
      ] as any,
    );

    await expect(mgr.routes()).resolves.toEqual([]);
  });

  it("resolves to an empty list for an empty routes array", async () => {
    const mgr = new ProvidersManagerImpl(undefined, routing([]), undefined);

    await expect(mgr.routes()).resolves.toEqual([]);
  });
});

describe("ProvidersManagerImpl — reason derivation", () => {
  it("reports explicit-route when nothing else explains the choice", async () => {
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([{ capability: "embedding", provider: "openai" }]),
      undefined,
    );

    await expect(mgr.routes()).resolves.toEqual([
      { capability: "embedding", provider: "openai", reason: "explicit-route" },
    ]);
  });

  it("reports explicit-model-provider when a chat route matches the model's prefix", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude-3-7-sonnet"),
      routing([{ capability: "chat", provider: "anthropic" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-model-provider");
  });

  it("does not claim model-provider when the chat route names a different provider", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude-3-7-sonnet"),
      routing([{ capability: "chat", provider: "openai" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-route");
  });

  it("does not claim model-provider for a non-chat capability on the same provider", async () => {
    // The prefix only explains the CHAT route; reusing it for embeddings would
    // report a reason the model selection never justified.
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude-3-7-sonnet"),
      routing([{ capability: "embedding", provider: "anthropic" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-route");
  });

  it("ignores a model id carrying no provider prefix", async () => {
    const mgr = new ProvidersManagerImpl(
      model("claude-3-7-sonnet"),
      routing([{ capability: "chat", provider: "anthropic" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-route");
  });

  it("reports first-available-plugin-provider when a plugin is enabled by name", async () => {
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([{ capability: "chat", provider: "openai" }]),
      { enabled: ["openai-plugin"] },
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("first-available-plugin-provider");
  });

  it("keeps explicit-route when the settings form enables no plugin", async () => {
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([{ capability: "chat", provider: "openai" }]),
      { enabled: [] },
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-route");
  });

  /**
   * Pins current behaviour. `enabledPluginNames` reads only the named-enable
   * SETTINGS form; the code-`Plugin` ARRAY form collapses to `[]` by design
   * (see `asPluginsSettings`). So a caller who passes real plugin objects never
   * sees `first-available-plugin-provider`, even though a plugin is present.
   * Worth knowing before reading this reason as "no plugin is installed".
   */
  it("does not count code-Plugin objects passed as an array", async () => {
    const plugin = { name: "openai-plugin", version: "1.0.0", kind: "general", register() {} };
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([{ capability: "chat", provider: "openai" }]),
      // biome-ignore lint/suspicious/noExplicitAny: minimal structural plugin
      [plugin] as any,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-route");
  });

  it("prefers the model prefix over an enabled plugin", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude-3-7-sonnet"),
      routing([{ capability: "chat", provider: "anthropic" }]),
      { enabled: ["p"] },
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-model-provider");
  });
});

describe("ProvidersManagerImpl — model surfacing", () => {
  it("surfaces the route's explicit model verbatim", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:whatever"),
      routing([{ capability: "chat", provider: "anthropic", model: "claude-opus-4" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.model).toBe("claude-opus-4");
  });

  it("omits the model entirely for a provider with no default", async () => {
    const mgr = new ProvidersManagerImpl(
      model("openai:gpt-4o"),
      routing([{ capability: "chat", provider: "openai" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.reason).toBe("explicit-model-provider");
    expect(route).not.toHaveProperty("model");
  });

  /**
   * Pins CURRENT behaviour, and it is wrong in a way worth recording.
   *
   * `extractModelName`'s comment says it will "surface the model name from the
   * prefix split" — but it does not split anything. It calls
   * `defaultModelForProvider`, which returns the hard-coded literal
   * `claude-3-7-sonnet` for anthropic. So a user on `anthropic:claude-opus-4`
   * who does not set `route.model` is told their chat route resolves to
   * `claude-3-7-sonnet` — a model they never selected.
   *
   * The test asserts what ships so the discrepancy is visible rather than
   * latent; fixing it is a product decision, not a test change.
   */
  it("reports the hard-coded anthropic default instead of the selected model", async () => {
    const mgr = new ProvidersManagerImpl(
      model("anthropic:claude-opus-4"),
      routing([{ capability: "chat", provider: "anthropic" }]),
      undefined,
    );

    const [route] = await mgr.routes();

    expect(route?.model).toBe("claude-3-7-sonnet");
    expect(route?.model).not.toBe("claude-opus-4");
  });
});

describe("ProvidersManagerImpl — duplicate capabilities", () => {
  it("keeps only the first route for a repeated capability", async () => {
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([
        { capability: "chat", provider: "openai" },
        { capability: "chat", provider: "anthropic" },
      ]),
      undefined,
    );

    const routes = await mgr.routes();

    // First-wins is what makes the inspector's answer match the runtime's; a
    // later duplicate silently overriding it would make this report a lie.
    expect(routes).toHaveLength(1);
    expect(routes[0]?.provider).toBe("openai");
  });

  it("keeps distinct capabilities in declaration order", async () => {
    const mgr = new ProvidersManagerImpl(
      undefined,
      routing([
        { capability: "chat", provider: "openai" },
        { capability: "embedding", provider: "cohere" },
      ]),
      undefined,
    );

    const routes = await mgr.routes();

    expect(routes.map((r) => r.capability)).toEqual(["chat", "embedding"]);
  });
});
