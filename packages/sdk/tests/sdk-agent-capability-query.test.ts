/**
 * A caller must be able to ASK whether an operation exists, instead of finding out by catching.
 *
 * `SDKAgent` is the single handle both runtimes return, and it does not model the difference between
 * them. `downloadArtifact` is a REQUIRED member whose local implementation rejects for every input
 * (`local-agent.ts:535`) — a subtype strengthening an inherited precondition to "never", which is
 * the textbook Liskov break. `listArtifacts` is the softer twin: required, and local returns `[]`
 * regardless of state, so "no artifacts" and "this runtime has no artifacts" are one value. Five
 * more members are declared optional and are PRESENT-BUT-THROWING on cloud, so
 * `typeof agent.fork === "function"` is `true` and calling it throws — optionality does not model
 * the constraint either.
 *
 * The package already solved this one layer down: `Run.supports(op)` / `Run.unsupportedReason(op)`
 * over a `RunOperation` union. This mirrors it on the agent, which is additive: nothing is removed,
 * no signature changes, and a caller that never asks behaves exactly as before.
 *
 * IT IS A MITIGATION, NOT THE STRUCTURAL FIX, and the finding says so. Splitting `SDKAgent` into a
 * common core plus `LocalCapableAgent` / `CloudCapableAgent` would let the compiler refuse the call
 * instead of the runtime, and a consumer would narrow once rather than ask per call. That change is
 * breaking on a published 4.x surface, so it is recorded rather than smuggled in here.
 */
import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

useTempCwd();

const FIXTURE = {
  apiKey: "theo_test_capability",
  model: { id: "openai/gpt-4o-mini" },
  local: { sandboxOptions: { enabled: false } as const },
} as const;

describe("SDKAgent capability query", () => {
  it("a local agent reports the operations it cannot perform, before they are called", async () => {
    const agent = await Agent.create(FIXTURE);
    try {
      expect(agent.supports("send")).toBe(true);
      expect(
        agent.supports("downloadArtifact"),
        "downloadArtifact is a REQUIRED member that rejects unconditionally on local — the whole " +
          "reason a caller needs to ask rather than try",
      ).toBe(false);
      expect(agent.unsupportedReason("downloadArtifact")).toBeTypeOf("string");
      expect(agent.unsupportedReason("send")).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  });

  it("the answer matches what the method actually does", async () => {
    // The query is worthless if it can disagree with the behaviour. This asserts the pair.
    const agent = await Agent.create(FIXTURE);
    try {
      expect(agent.supports("downloadArtifact")).toBe(false);
      await expect(agent.downloadArtifact("whatever")).rejects.toThrow();
    } finally {
      await agent.dispose();
    }
  });

  it("a cloud agent reports the five optional members that are present-but-throwing", async () => {
    // The cloud half of the same defect, and the more surprising one: these are declared OPTIONAL,
    // so the idiomatic feature-check `typeof agent.fork === "function"` returns true and the call
    // throws anyway. Optionality models "may be absent from the type", never "absent at runtime".
    const agent = await Agent.create({
      apiKey: FIXTURE.apiKey,
      model: FIXTURE.model,
      cloud: { repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }] },
    });
    try {
      expect(agent.supports("send")).toBe(true);
      expect(
        agent.supports("downloadArtifact"),
        "artifacts are the cloud runtime's own concept",
      ).toBe(true);
      for (const op of [
        "fork",
        "runUntil",
        "runToCompletion",
        "streamToCompletion",
        "usePersonality",
      ] as const) {
        expect(agent.supports(op), `${op} throws on cloud, so the query must say so`).toBe(false);
        expect(agent.unsupportedReason(op)).toBeTypeOf("string");
      }
      // invalidateCache is the dangerous shape: it does not throw, it returns as if it worked.
      expect(agent.supports("invalidateCache")).toBe(false);
      // Agreement with behaviour, on the runtime where the members are merely optional.
      expect(typeof agent.fork, "the feature-check a consumer would reach for first").toBe(
        "function",
      );
      // Synchronous, unlike the local `downloadArtifact` rejection — another shape a caller
      // cannot infer from the type, and a second reason to ask instead of guessing the catch.
      expect(() => agent.fork?.({ allowedTools: new Set<string>(), prompt: "anything" })).toThrow();
    } finally {
      await agent.dispose();
    }
  });
});
