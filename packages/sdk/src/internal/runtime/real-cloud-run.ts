import { NetworkError } from "../../errors.js";
import type { AgentOptions, ModelSelection } from "../../types/agent.js";
import type { SDKAssistantMessage, SDKMessage, SDKStatusMessage } from "../../types/messages.js";
import type { Run, RunOperation, RunStatus, SDKUserMessage, SendOptions } from "../../types/run.js";
import { resolveApiKey } from "../env.js";
import { getConfiguredBaseUrl } from "../fixture-mode.js";
import { parseSseStream } from "../llm/sse.js";
import { FixtureRunBase, prepareRunContext } from "./fixture-run-base.js";
import type { FixtureScript } from "./fixture-types.js";

/**
 * Real cloud Run. When `THEOKIT_API_BASE_URL` is set + the API key is not
 * a fixture key, the Run hits the PaaS SSE endpoint at
 * `POST /v1/agents/{agentId}/runs` and translates server events into our
 * `SDKMessage` stream.
 *
 * The server contract is intentionally minimal in Phase 1:
 *   - `event: status` `data: {"status":"CREATING|RUNNING|FINISHED|ERROR"}`
 *   - `event: assistant` `data: {"text":"..."}`
 *   - `event: result` `data: {"result":"...", "status":"finished"}`
 *
 * @internal
 */

export interface CreateRealCloudRunOptions {
  agentId: string;
  model: ModelSelection;
  message: string | SDKUserMessage;
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  fetch?: typeof fetch;
  /** Pre-resolved system prompt threaded by `CloudAgent.send`. */
  systemPrompt?: string;
}

export function createRealCloudRun(options: CreateRealCloudRunOptions): Run {
  const { userText, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>([
    "stream",
    "wait",
    "cancel",
    "conversation",
    "listArtifacts",
    "downloadArtifact",
  ]);

  const placeholderScript: FixtureScript = {
    events: [],
    finalStatus: "running",
    cancellable: false,
    conversation: [],
  };

  const apiKey = resolveApiKey(options.agentOptions.apiKey);
  const baseUrl = getConfiguredBaseUrl();
  const handle = new RealCloudRun(
    {
      id,
      agentId: options.agentId,
      model: options.model,
      script: placeholderScript,
      supportedOps: supported,
      startTime,
    },
    {
      apiKey,
      baseUrl,
      userText,
      fetchImpl: options.fetch ?? fetch,
      sendOptions: options.sendOptions,
      systemPrompt: options.systemPrompt,
    },
  );
  handle.bootstrap();
  return handle;
}

interface RealCloudRunInputs {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  userText: string;
  fetchImpl: typeof fetch;
  sendOptions: SendOptions;
  systemPrompt: string | undefined;
}

class RealCloudRun extends FixtureRunBase {
  private readonly inputs: RealCloudRunInputs;
  private readonly controller = new AbortController();

  constructor(
    options: ConstructorParameters<typeof FixtureRunBase>[0],
    inputs: RealCloudRunInputs,
  ) {
    super(options);
    this.inputs = inputs;
  }

  bootstrap(): void {
    setTimeout(() => {
      void this.drive();
    }, 0);
  }

  protected override notifyImmediately(): boolean {
    return true;
  }

  override cancel(): Promise<void> {
    this.controller.abort();
    return super.cancel();
  }

  private async drive(): Promise<void> {
    if (this.inputs.apiKey === undefined || this.inputs.baseUrl === undefined) {
      this.fail("Real cloud Run requires THEOKIT_API_KEY + THEOKIT_API_BASE_URL");
      return;
    }
    try {
      const response = await this.postRun(this.inputs.apiKey, this.inputs.baseUrl);
      await this.consumeStream(response);
    } catch (cause) {
      if (this.terminated) return;
      this.fail(cause instanceof Error ? cause.message : String(cause));
    }
  }

  private async postRun(apiKey: string, baseUrl: string): Promise<Response> {
    const response = await this.inputs.fetchImpl(`${baseUrl}/v1/agents/${this.agentId}/runs`, {
      method: "POST",
      signal: this.controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        message: this.inputs.userText,
        mcpServers: this.inputs.sendOptions.mcpServers,
        ...(this.inputs.systemPrompt !== undefined
          ? { systemPrompt: this.inputs.systemPrompt }
          : {}),
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new NetworkError(
        `Cloud Run endpoint returned ${response.status}: ${text.slice(0, 200)}`,
        { code: "cloud_run_http_error" },
      );
    }
    return response;
  }

  private async consumeStream(response: Response): Promise<void> {
    let finalStatus: RunStatus = "finished";
    let finalText = "";
    for await (const record of parseSseStream(response.body, this.controller.signal)) {
      const parsed = safeParse(record.data);
      if (parsed === undefined) continue;
      const update = this.applyRecord(record.event, parsed);
      if (update.finalText !== undefined) finalText = update.finalText;
      if (update.finalStatus !== undefined) finalStatus = update.finalStatus;
    }
    if (finalText.length > 0) this.script.result = finalText;
    this.transitionTo(finalStatus);
  }

  private applyRecord(
    eventName: string,
    parsed: Record<string, unknown>,
  ): { finalText?: string; finalStatus?: RunStatus } {
    if (eventName === "status") {
      this.script.events.push(this.buildStatusEvent(parsed.status as string));
      this.notifyNewEvents();
      return {};
    }
    if (eventName === "assistant") {
      const text = typeof parsed.text === "string" ? parsed.text : "";
      this.script.events.push(this.buildAssistantEvent(text));
      this.notifyNewEvents();
      return { finalText: text };
    }
    if (eventName === "result") {
      const update: { finalText?: string; finalStatus?: RunStatus } = {
        finalStatus: (parsed.status as RunStatus | undefined) ?? "finished",
      };
      if (typeof parsed.result === "string") update.finalText = parsed.result;
      return update;
    }
    return {};
  }

  private buildStatusEvent(status: string): SDKStatusMessage {
    return {
      type: "status",
      agent_id: this.agentId,
      run_id: this.id,
      status: status as SDKStatusMessage["status"],
    };
  }

  private buildAssistantEvent(text: string): SDKAssistantMessage {
    return {
      type: "assistant",
      agent_id: this.agentId,
      run_id: this.id,
      message: { role: "assistant", content: [{ type: "text", text }] },
    };
  }

  private fail(message: string): void {
    const event: SDKAssistantMessage = this.buildAssistantEvent(message);
    this.script.events.push(event satisfies SDKMessage);
    this.notifyNewEvents();
    this.script.result = message;
    this.transitionTo("error" satisfies RunStatus);
  }
}

function safeParse(data: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
