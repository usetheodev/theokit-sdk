import { UnsupportedRunOperationError } from "../../errors.js";
import type {
  AgentOptions,
  ModelSelection,
  SDKAgent,
  SDKArtifact,
} from "../../types/agent.js";
import type { Run, SDKUserMessage, SendOptions } from "../../types/run.js";
import { generateLocalAgentId } from "../ids.js";
import { registerAgent, updateRegisteredAgent } from "./agent-registry.js";
import { createLocalRun } from "./local-run.js";

/**
 * Local SDKAgent implementation. Wraps the in-process fixture responder
 * and tracks per-agent state in the process-wide agent registry.
 *
 * @internal
 */
export class LocalAgent implements SDKAgent {
  readonly agentId: string;
  model: ModelSelection | undefined;
  private readonly options: AgentOptions;
  private readonly workspaceCwd: string;
  private disposed = false;

  constructor(options: AgentOptions) {
    this.agentId = options.agentId ?? generateLocalAgentId();
    this.model = options.model;
    this.options = options;
    this.workspaceCwd = resolveCwd(options.local?.cwd);

    registerAgent({
      agentId: this.agentId,
      runtime: "local",
      name: options.name,
      summary: "Local contract fixture",
      model: this.model,
      createdAt: Date.now(),
      lastModified: Date.now(),
      archived: false,
      options,
      cwd: this.workspaceCwd,
      status: "finished",
    });

    // Wire Symbol.asyncDispose for `await using` consumers.
    (this as Record<symbol, unknown>)[Symbol.asyncDispose] = () => this.dispose();
  }

  send(
    message: string | SDKUserMessage,
    options: SendOptions = {},
  ): Promise<Run> {
    if (this.disposed) {
      throw new Error("Agent has been disposed");
    }
    const overrideModel = options.model;
    if (overrideModel !== undefined) {
      this.model = overrideModel;
      updateRegisteredAgent(this.agentId, { model: overrideModel });
    }
    const run = createLocalRun({
      agentId: this.agentId,
      model: this.model,
      message,
      agentOptions: this.options,
      sendOptions: options,
      workspaceCwd: this.workspaceCwd,
    });
    return Promise.resolve(run);
  }

  close(): void {
    this.disposed = true;
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }

  listArtifacts(): Promise<SDKArtifact[]> {
    return Promise.resolve([]);
  }

  downloadArtifact(_path: string): Promise<Buffer> {
    return Promise.reject(
      new UnsupportedRunOperationError(
        "Artifacts are not supported for local agents",
        "downloadArtifact",
      ),
    );
  }
}

function resolveCwd(cwd: string | string[] | undefined): string {
  if (Array.isArray(cwd)) return cwd[0] ?? process.cwd();
  return cwd ?? process.cwd();
}
