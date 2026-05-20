import {
  ConfigurationError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "../../errors.js";
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
import { withCwdMutex } from "../memory/cwd-mutex.js";
import { flushRegistrySaves, registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { serializeCloudAgentConfig } from "./cloud-config-serializer.js";
import type { CloudAgentPayload } from "./cloud-payload-types.js";
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
  /**
   * Canonical JSON contract payload (ADR D15) that PaaS receives at runtime.
   * Re-serialized by `reload()` when filesystem state changes.
   * Public for contract testing — consumers can inspect what would be sent.
   */
  cloudPayload: CloudAgentPayload;
  private readonly options: AgentOptions;
  /** Idempotency guard for dispose() (EC-3). */
  private disposed = false;

  constructor(options: AgentOptions, providedAgentId?: string) {
    this.agentId = providedAgentId ?? options.agentId ?? generateCloudAgentId();
    this.model = options.model;
    this.options = options;
    this.cloudPayload = serializeCloudAgentConfig({ ...options, agentId: this.agentId });

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
      // Persistence routing only (ADR D17). Cloud agents do not surface `cwd`
      // through `SDKAgentInfo` (toCloudAgentInfo strips it).
      cwd: process.cwd(),
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
    // Custom inline tools are local-only — cloud agents reject per-call
    // tools the same way creation-time tools are rejected (handlers cannot
    // cross the wire). Mirror the ConfigurationError code so callers can
    // catch both surfaces uniformly.
    if (options.tools !== undefined && options.tools.length > 0) {
      throw new ConfigurationError(
        "Custom inline tools are local-only in SDK v1.0 — cloud agents cannot serialize handler functions",
        { code: "cloud_custom_tools_rejected" },
      );
    }
    // ADR D19: same per-agent send mutex as LocalAgent. Holds until the run
    // completes so concurrent sends to the same agentId serialize end-to-end.
    return new Promise<Run>((resolve, reject) => {
      void withCwdMutex(`agent-send:${this.agentId}`, async () => {
        let run: Run;
        try {
          run = await this.sendLocked(message, options);
        } catch (err) {
          reject(err);
          return;
        }
        resolve(run);
        try {
          await run.wait();
        } catch {
          // Caller observes via their own wait/stream.
        }
      });
    });
  }

  private async sendLocked(message: string | SDKUserMessage, options: SendOptions): Promise<Run> {
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
    return useRealRuntime
      ? createRealCloudRun({
          agentId: this.agentId,
          model: this.model ?? { id: DEFAULT_AGENTIC_MODEL_ID },
          message,
          agentOptions: this.options,
          sendOptions: options,
          agentConfig: this.cloudPayload,
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
    // EC-6: re-serialize the cloud payload so filesystem-derived state
    // (skills.enabled may shift as new SKILL.md files appear in repo) is
    // reflected in subsequent send() dispatches.
    this.cloudPayload = serializeCloudAgentConfig({ ...this.options, agentId: this.agentId });
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    // EC-3: idempotent. `await using` may dispatch dispose twice (the using
    // exit hook + explicit `await agent.dispose()`); second call is a no-op.
    if (this.disposed) return;
    this.disposed = true;
    await flushRegistrySaves(process.cwd());
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

  /**
   * Cloud runtime manages goal loops server-side (ADR D122). The local
   * fork pattern is also not available in cloud — both throw synchronously
   * with `UnsupportedRunOperationError` so callers branch early (EC-G).
   *
   * @public
   */
  runUntil(): never {
    throw new UnsupportedRunOperationError(
      "Agent.runUntil() is not supported on cloud agents. Cloud runtime manages goal loops server-side. Use a local agent for autonomous Ralph loops.",
      "runUntil",
    );
  }

  /**
   * Forked sub-agents are local-only (ADRs D110-D114).
   *
   * @public
   */
  fork(): never {
    throw new UnsupportedRunOperationError(
      "Agent.fork() is not supported on cloud agents. Fork inheritance requires local credential + system-prompt access. Use a local agent.",
      "fork",
    );
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
