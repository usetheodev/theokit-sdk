/**
 * TheoKitContainer — optional unified registry for multi-agent coordination
 * (T11.3, ADR D452).
 *
 * Does NOT replace Agent.create() — it's sugar for enterprise setups that
 * manage multiple agents + tools + workflows from a single instance.
 *
 * @public
 */

export interface AgentConfig {
  model: string;
  systemPrompt?: string;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface TheoKitContainerOptions {
  agents?: Record<string, AgentConfig>;
  tools?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
}

export class TheoKitContainer {
  private readonly _agents: ReadonlyMap<string, AgentConfig>;
  private readonly _tools: ReadonlyMap<string, unknown>;
  private readonly _workflows: ReadonlyMap<string, unknown>;
  private readonly _instances = new Map<string, { disposed: boolean }>();

  constructor(opts: TheoKitContainerOptions) {
    this._agents = new Map(Object.entries(opts.agents ?? {}));
    this._tools = new Map(Object.entries(opts.tools ?? {}));
    this._workflows = new Map(Object.entries(opts.workflows ?? {}));
  }

  agent(name: string): AgentConfig & { model: string; dispose: () => void } {
    const config = this._agents.get(name);
    if (!config) {
      throw new Error(
        `Agent "${name}" not registered in container. Available: ${[...this._agents.keys()].join(", ")}`,
      );
    }
    const instance = this._instances.get(name) ?? { disposed: false };
    this._instances.set(name, instance);
    return {
      ...config,
      dispose: () => {
        instance.disposed = true;
      },
    };
  }

  tool(name: string): unknown {
    const tool = this._tools.get(name);
    if (!tool) {
      throw new Error(
        `Tool "${name}" not registered in container. Available: ${[...this._tools.keys()].join(", ")}`,
      );
    }
    return tool;
  }

  workflow(name: string): unknown {
    const wf = this._workflows.get(name);
    if (!wf) {
      throw new Error(
        `Workflow "${name}" not registered in container. Available: ${[...this._workflows.keys()].join(", ")}`,
      );
    }
    return wf;
  }

  async run(agentName: string, input: string): Promise<unknown> {
    const instance = this._instances.get(agentName);
    if (instance?.disposed) {
      throw new Error(`AgentDisposedError: Agent "${agentName}" has been disposed`);
    }
    const config = this._agents.get(agentName);
    if (!config) {
      throw new Error(`Agent "${agentName}" not registered in container`);
    }
    // Delegate to Agent.create — lazy import to avoid circular dep
    const { Agent } = await import("./agent.js");
    const agent = await Agent.create({
      model: { id: config.model },
      apiKey: (config.apiKey as string) ?? "theo_test_fixture",
      systemPrompt: config.systemPrompt,
    });
    try {
      const run = await agent.send(input);
      return await run.wait();
    } finally {
      agent.dispose();
    }
  }

  listAgents(): string[] {
    return [...this._agents.keys()];
  }

  listTools(): string[] {
    return [...this._tools.keys()];
  }

  listWorkflows(): string[] {
    return [...this._workflows.keys()];
  }
}
