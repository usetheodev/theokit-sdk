import { ConfigurationError, UnknownAgentError } from "../../errors.js";
import type { AgentOptions, ModelSelection, SDKAgent, SDKArtifact } from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import { generateCloudAgentId } from "../ids.js";
import { registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { createCloudRun } from "./cloud-run.js";

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
  private artifacts: SDKArtifact[];

  constructor(options: AgentOptions, providedAgentId?: string) {
    this.agentId = providedAgentId ?? options.agentId ?? generateCloudAgentId();
    this.model = options.model;
    this.options = options;
    this.artifacts = buildFixtureArtifacts();

    const repoUrls = (options.cloud?.repos ?? []).map((repo) => repo.url);
    registerAgent({
      agentId: this.agentId,
      runtime: "cloud",
      name: options.name,
      summary: "Cloud contract fixture",
      model: this.model,
      createdAt: Date.now(),
      lastModified: Date.now(),
      archived: false,
      options,
      repos: repoUrls,
      status: "running",
    });

    (this as Record<symbol, unknown>)[Symbol.asyncDispose] = () => this.dispose();
  }

  send(message: string | SDKUserMessage, options: SendOptions = {}): Promise<Run> {
    const overrideModel = options.model;
    if (overrideModel !== undefined) {
      this.model = overrideModel;
      updateRegisteredAgent(this.agentId, { model: overrideModel });
    }
    const run = createCloudRun({
      agentId: this.agentId,
      model: this.model ?? { id: "composer-2" },
      message,
      agentOptions: this.options,
      sendOptions: options,
    });
    return Promise.resolve(run);
  }

  close(): void {
    // Cloud agents stay registered until explicit dispose/delete.
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  listArtifacts(): Promise<SDKArtifact[]> {
    return Promise.resolve(this.artifacts);
  }

  downloadArtifact(path: string): Promise<Buffer> {
    if (path.includes("..") || path.startsWith("/")) {
      return Promise.reject(
        new ConfigurationError(`Artifact path must stay inside the workspace: ${path}`, {
          code: "artifact_path_traversal",
        }),
      );
    }
    const match = this.artifacts.find((artifact) => artifact.path === path);
    if (match === undefined) {
      return Promise.reject(
        new UnknownAgentError(`Artifact ${path} not found`, { code: "unknown_artifact" }),
      );
    }
    return Promise.resolve(Buffer.from(`fixture artifact content for ${path}\n`));
  }
}

function buildFixtureArtifacts(): SDKArtifact[] {
  return [
    {
      path: "dist/report.txt",
      sizeBytes: 42,
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ];
}
