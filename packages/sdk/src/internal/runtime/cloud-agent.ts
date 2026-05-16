import { ConfigurationError, UnknownAgentError } from "../../errors.js";
import type {
  AgentOptions,
  ModelSelection,
  SDKAgent,
  SDKArtifact,
  SystemPromptContext,
} from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import { resolveApiKey } from "../env.js";
import { getConfiguredBaseUrl, isFixtureApiKey } from "../fixture-mode.js";
import { generateCloudAgentId } from "../ids.js";
import { registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { createCloudRun } from "./cloud-run.js";
import { DEFAULT_AGENTIC_MODEL_ID } from "./default-model.js";
import { createRealCloudRun } from "./real-cloud-run.js";
import { resolveSystemPromptForSend } from "./system-prompt.js";

/**
 * Cloud SDKAgent implementation. Holds the cloud configuration and routes
 * runs to the fixture responder (which mimics PaaS behavior) or to real HTTP
 * when `THEOKIT_API_BASE_URL` is set.
 *
 * @internal
 */
export class CloudAgent implements SDKAgent {
  readonly agentId: string;
  model: ModelSelection | undefined;
  private readonly options: AgentOptions;
  /** Idempotency guard for dispose() (EC-3). */
  private disposed = false;

  constructor(options: AgentOptions, providedAgentId?: string) {
    this.agentId = providedAgentId ?? options.agentId ?? generateCloudAgentId();
    this.model = options.model;
    this.options = options;

    const repoUrls = (options.cloud?.repos ?? []).map((repo) => repo.url);
    registerAgent({
      agentId: this.agentId,
      runtime: "cloud",
      name: options.name,
      summary: this.isFixtureMode() ? "Cloud contract fixture" : "Cloud agent",
      model: this.model,
      createdAt: Date.now(),
      lastModified: Date.now(),
      archived: false,
      options,
      repos: repoUrls,
      status: "running",
    });
  }

  /**
   * Fixture-mode is on iff the API key matches the `theo_test_*` test pattern
   * AND no real `THEOKIT_API_BASE_URL` is configured. Outside fixture-mode,
   * cloud operations are pre-release and must surface explicit errors.
   */
  private isFixtureMode(): boolean {
    const apiKey = resolveApiKey(this.options.apiKey);
    return isFixtureApiKey(apiKey) && getConfiguredBaseUrl() === undefined;
  }

  async send(message: string | SDKUserMessage, options: SendOptions = {}): Promise<Run> {
    const overrideModel = options.model;
    if (overrideModel !== undefined) {
      this.model = overrideModel;
      updateRegisteredAgent(this.agentId, { model: overrideModel });
    }
    const userText = typeof message === "string" ? message : message.text;
    const systemPrompt = await this.resolveSystemPromptForSend(userText, options);
    const apiKey = resolveApiKey(this.options.apiKey);
    const useRealRuntime =
      apiKey !== undefined && !isFixtureApiKey(apiKey) && getConfiguredBaseUrl() !== undefined;
    const run = useRealRuntime
      ? createRealCloudRun({
          agentId: this.agentId,
          model: this.model ?? { id: DEFAULT_AGENTIC_MODEL_ID },
          message,
          agentOptions: this.options,
          sendOptions: options,
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        })
      : createCloudRun({
          agentId: this.agentId,
          model: this.model ?? { id: DEFAULT_AGENTIC_MODEL_ID },
          message,
          agentOptions: this.options,
          sendOptions: options,
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        });
    return run;
  }

  private resolveSystemPromptForSend(
    userText: string,
    options: SendOptions,
  ): Promise<string | undefined> {
    return resolveSystemPromptForSend(
      this.options.systemPrompt,
      options.systemPrompt,
      (): Promise<SystemPromptContext> =>
        Promise.resolve({
          agentId: this.agentId,
          cwd: undefined,
          model: this.model,
          skills: [],
          userMessage: userText,
          memory: [],
        }),
    );
  }

  close(): void {
    // Cloud agents stay registered until explicit dispose/delete.
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    // EC-3: idempotent. `await using` may dispatch dispose twice (the using
    // exit hook + explicit `await agent.dispose()`); second call is a no-op.
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    return Promise.resolve();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  listArtifacts(): Promise<SDKArtifact[]> {
    if (!this.isFixtureMode()) {
      return Promise.reject(
        new ConfigurationError(
          "Cloud runtime is pre-release. listArtifacts() will return real artifacts when Theo PaaS ships; today it is only available in fixture mode (theo_test_* keys).",
          { code: "cloud_runtime_pre_release" },
        ),
      );
    }
    return Promise.resolve(buildFixtureArtifacts());
  }

  downloadArtifact(path: string): Promise<Buffer> {
    if (path.includes("..") || path.startsWith("/")) {
      return Promise.reject(
        new ConfigurationError(`Artifact path must stay inside the workspace: ${path}`, {
          code: "artifact_path_traversal",
        }),
      );
    }
    if (!this.isFixtureMode()) {
      return Promise.reject(
        new ConfigurationError(
          "Cloud runtime is pre-release. downloadArtifact() will fetch real PaaS artifacts when the cloud runtime ships; today it is only available in fixture mode (theo_test_* keys).",
          { code: "cloud_runtime_pre_release" },
        ),
      );
    }
    const match = buildFixtureArtifacts().find((artifact) => artifact.path === path);
    if (match === undefined) {
      return Promise.reject(
        new UnknownAgentError(`Artifact ${path} not found`, { code: "unknown_artifact" }),
      );
    }
    return Promise.resolve(Buffer.from(`fixture artifact content for ${path}\n`));
  }
}

/**
 * Canonical fixture artifact list. Only used when the agent is in fixture
 * mode (theo_test_* keys, no THEOKIT_API_BASE_URL). Real PaaS artifacts will
 * be fetched over HTTP when the cloud runtime ships.
 */
function buildFixtureArtifacts(): SDKArtifact[] {
  return [
    {
      path: "dist/report.txt",
      sizeBytes: 42,
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];
}
