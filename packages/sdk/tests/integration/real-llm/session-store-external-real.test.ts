/**
 * SE41 — end-to-end real-LLM acceptance: an EXTERNAL SessionStore (in-memory Map,
 * standing in for Postgres / Redis) is the primary store AND resume source, and a
 * REAL LLM recalls a planted fact across a SIMULATED cold start (in-memory caches
 * cleared; only the store carries the history). This is the serverless / multi-host
 * resume the FS-default cannot provide, proven against a real model per
 * `.claude/rules/real-llm-validation.md`. Gated on OPENROUTER_API_KEY.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { Agent } from "../../../src/index.js";
import type { SessionRecord } from "../../../src/internal/persistence/session-transcript.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../../../src/internal/runtime/registry/agent-registry.js";
import { clearAllSessions } from "../../../src/internal/session/agent-session.js";
import type { SessionStore } from "../../../src/types/session-store.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";
import { resolveRealLlmEnv } from "./_helpers/real-llm-env.js";

class MapSessionStore implements SessionStore {
  readonly byAgent = new Map<string, SessionRecord[]>();
  async readRecords(agentId: string): Promise<SessionRecord[]> {
    return [...(this.byAgent.get(agentId) ?? [])];
  }
  async appendRecords(agentId: string, records: readonly SessionRecord[]): Promise<void> {
    this.byAgent.set(agentId, [...(this.byAgent.get(agentId) ?? []), ...records]);
  }
}

const env = resolveRealLlmEnv("openrouter", { model: "openai/gpt-4o-mini" });
const CODEWORD = "MERIDIAN-53";

afterEach(() => {
  clearAllSessions();
  clearAgentRegistry();
  invalidateRegistryHydration();
});

describe.skipIf(env.shouldSkip)(
  "SE41 real-llm: external-store resume recalls across a cold start",
  () => {
    it("a resumed agent recalls a codeword from the external store (no local FS)", async () => {
      const store = new MapSessionStore();
      const cwd = mkdtempSync(join(tmpdir(), "se41-real-"));
      const __cwdCleanup1 = cwd;
      onTestFinished(() => {
        removeTempDirRobustSync(__cwdCleanup1);
      });
      const agentId = "agent-se41-real";
      const providers = { routes: [{ capability: "chat" as const, provider: "openrouter" }] };

      // Process 1 — plant the codeword; it persists ONLY through the external store.
      const a1 = await Agent.create({
        agentId,
        apiKey: env.apiKey,
        model: { id: env.model },
        systemPrompt: "You are concise. Remember any codeword the user gives you.",
        local: { cwd, sessionStore: store },
        providers,
      });
      const first = await (
        await a1.send(`Remember this codeword: ${CODEWORD}. Reply with just: OK.`)
      ).wait();
      expect(first.status).toBe("finished");
      await a1.dispose();
      expect((await store.readRecords(agentId)).length).toBeGreaterThan(0);

      // Simulated cold start: only the external store survives.
      clearAllSessions();
      clearAgentRegistry();
      invalidateRegistryHydration();

      // Process 2 — resume from the SAME store; the model recalls the codeword.
      const a2 = await Agent.resume(agentId, {
        apiKey: env.apiKey,
        model: { id: env.model },
        local: { cwd, sessionStore: store },
        providers,
      });
      const recall = await (
        await a2.send("What was the codeword? Reply with ONLY the codeword.")
      ).wait();
      await a2.dispose();

      expect(recall.status).toBe("finished");
      expect(String(recall.result).toUpperCase()).toContain(CODEWORD);
    }, 120_000);
  },
);
