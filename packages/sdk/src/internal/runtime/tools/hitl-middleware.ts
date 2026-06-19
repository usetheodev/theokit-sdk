/**
 * HITL (Human-In-The-Loop) interrupt middleware.
 *
 * Per ADR D3: intercepts tool calls matching a configurable list,
 * yields control to a caller-provided `approve` callback, and
 * resumes or aborts based on the result. Fail-closed on error (EC-4).
 *
 * @internal
 */

export interface HitlConfig {
  tools: string[];
  approve: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export class HitlTimeoutError extends Error {
  readonly code = "hitl_timeout" as const;
  constructor(toolName: string, timeoutMs: number) {
    super(`HITL approval timed out for tool "${toolName}" after ${timeoutMs}ms`);
    this.name = "HitlTimeoutError";
  }
}

export class HitlMiddleware {
  private readonly config: HitlConfig;

  constructor(config: HitlConfig) {
    this.config = config;
  }

  get tools(): readonly string[] {
    return this.config.tools;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async shouldProceed(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    if (!this.config.tools.includes(toolName)) {
      return true;
    }

    const timeout = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    try {
      const result = await Promise.race([
        this.config.approve(toolName, input),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), timeout)),
      ]);
      return result;
    } catch {
      // EC-4: fail-closed — if approve throws, reject the tool call
      return false;
    }
  }
}
