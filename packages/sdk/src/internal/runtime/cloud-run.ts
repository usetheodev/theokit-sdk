import type { AgentOptions, ModelSelection } from "../../types/agent.js";
import type {
  Run,
  RunGitInfo,
  RunOperation,
  RunResult,
  SDKUserMessage,
  SendOptions,
} from "../../types/run.js";
import { buildFixtureScript } from "./fixture-responder.js";
import {
  FixtureRunBase,
  type FixtureRunBaseOptions,
  prepareRunContext,
} from "./fixture-run-base.js";

/**
 * Options accepted by `createCloudRun()`.
 *
 * @internal
 */
export interface CreateCloudRunOptions {
  agentId: string;
  model: ModelSelection;
  message: string | SDKUserMessage;
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  /** Accepted for API parity; fixture cloud path does not use it. */
  systemPrompt?: string;
}

/**
 * Build a cloud Run handle. In fixture mode, mimics Theo PaaS behavior
 * (CREATING/RUNNING/FINISHED status events + git metadata on result).
 *
 * @internal
 */
export function createCloudRun(options: CreateCloudRunOptions): Run {
  const { userText, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>([
    "stream",
    "wait",
    "cancel",
    "conversation",
    "listArtifacts",
    "downloadArtifact",
  ]);

  const script = buildFixtureScript({
    agentId: options.agentId,
    runId: id,
    model: options.model,
    userMessage: userText,
    runtime: "cloud",
    agentOptions: options.agentOptions,
    sendOptions: options.sendOptions,
    workspaceCwd: undefined,
    subagents: {},
    settingSourcesIncludeProject: false,
    memoryFacts: [],
    sessionMessages: [],
    projectMcpServers: {},
  });

  const handle = new CloudRun({
    id,
    agentId: options.agentId,
    model: options.model,
    script,
    supportedOps: supported,
    startTime,
    git: buildGitInfo(),
  });
  handle.bootstrap();
  return handle;
}

interface CloudRunCtorOptions extends FixtureRunBaseOptions {
  git: RunGitInfo;
}

class CloudRun extends FixtureRunBase {
  git?: RunGitInfo;
  private readonly gitInfo: RunGitInfo;

  constructor(options: CloudRunCtorOptions) {
    super(options);
    this.gitInfo = options.git;
    this.git = options.git;
  }

  bootstrap(): void {
    if (this.script.cancellable) return;
    setTimeout(() => this.transitionTo(this.script.finalStatus), 0);
  }

  protected override extendRunResult(result: RunResult): RunResult {
    return { ...result, git: this.gitInfo };
  }
}

function buildGitInfo(): RunGitInfo {
  return {
    branches: [
      {
        repoUrl: "https://github.com/usetheo/example",
        branch: "feat/contract-fixture",
        prUrl: "https://github.com/usetheo/example/pull/1",
      },
    ],
  };
}
