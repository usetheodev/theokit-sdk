/**
 * HITL (Human-In-The-Loop) interrupt middleware.
 *
 * Per ADR D3: intercepts tool calls matching a configurable list,
 * yields control to a caller-provided `approve` callback, and
 * resumes or aborts based on the result. Fail-closed on error (EC-4).
 *
 * NOT WIRED (measured 2026-08-20, B-141). Nothing constructs `HitlMiddleware`
 * outside `tests/hitl/hitl-middleware.test.ts`: it is absent from the tool
 * dispatch path, from the public barrel, and from every other file in the
 * monorepo — a case-insensitive grep for "hitl" across every package source
 * tree returns this file alone. The behaviour below is correct and covered; it
 * is simply not reachable by anyone using the SDK. Left in place rather than
 * deleted because whether the SDK should offer an approval gate is a product
 * decision, not a cleanup call — but recorded here so a passing test suite is
 * not read as a shipped feature.
 *
 * OPEN QUESTION for whoever wires it: `shouldProceed` answers `boolean`, so a
 * timeout and an explicit refusal arrive at the caller as the same `false`.
 * "A human said no" and "nobody was there" are different facts, and a retry
 * policy cannot act on the difference. `HitlTimeoutError` below was declared to
 * carry it and is thrown by nothing. Fail-closed on timeout is right and should
 * survive any change here; whether the REASON survives with it is the part that
 * is unsettled. Two characterization tests pin the current answer so a change
 * has to be deliberate — see `tests/hitl/hitl-middleware.test.ts` (B-141).
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
