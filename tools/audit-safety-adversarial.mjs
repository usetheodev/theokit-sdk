// Adversarial safety audit (ADR D35).
//
// Each scenario is a function returning a string describing the outcome.
// We classify outcomes as `blocked` / `allowed-but-safe` / `crashed` /
// `unexpected`. Target: 100% in `blocked` or `allowed-but-safe`.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Agent,
  ConfigurationError,
} from "/home/paulo/Projetos/usetheo/theokit-sdk/packages/sdk/dist/index.js";

// API key is intentionally not used — all scenarios are validation-only and
// must reject pre-LLM (no real provider call required). Keeping the env check
// commented for future expansion to runtime-sandbox scenarios.
// const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

async function run(scenarios) {
  const results = [];
  for (const sc of scenarios) {
    process.stdout.write(`Running [${sc.id}] ${sc.title}... `);
    try {
      const out = await sc.exec();
      results.push({ ...sc, outcome: out.outcome, detail: out.detail });
      console.log(out.outcome);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      results.push({ ...sc, outcome: "crashed", detail: message });
      console.log(`crashed: ${message.slice(0, 80)}`);
    }
  }
  return results;
}

/** S1: Custom tool name "shell" must be rejected at validation time. */
const s1 = {
  id: "S1",
  title: "Reserved tool name 'shell' rejected",
  family: "Validation",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s1-"));
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "shell",
            description: "shadow",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      });
      return { outcome: "unexpected", detail: "create succeeded with reserved name" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "tool_reserved_name") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** S2: Duplicate tool names rejected. */
const s2 = {
  id: "S2",
  title: "Duplicate tool names rejected",
  family: "Validation",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s2-"));
    const tool = {
      name: "dup",
      description: "x",
      inputSchema: { type: "object" },
      handler: () => "a",
    };
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [tool, { ...tool }],
      });
      return { outcome: "unexpected", detail: "dup not detected" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "duplicate_tool_name") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S3: Cloud agent rejects custom tools (handlers can't cross wire). */
const s3 = {
  id: "S3",
  title: "Cloud agent rejects non-empty tools",
  family: "Permission",
  exec: async () => {
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        cloud: {},
        tools: [
          {
            name: "noop",
            description: "x",
            inputSchema: { type: "object" },
            handler: () => "x",
          },
        ],
      });
      return { outcome: "unexpected", detail: "cloud + tools accepted" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "cloud_custom_tools_rejected") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S4: Tool with non-object schema rejected. */
const s4 = {
  id: "S4",
  title: "Tool inputSchema not object → rejected",
  family: "Validation",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s4-"));
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        tools: [
          {
            name: "bad",
            description: "x",
            inputSchema: { type: "string" },
            handler: () => "x",
          },
        ],
      });
      return { outcome: "unexpected", detail: "non-object schema accepted" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "tool_invalid_schema_type") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S5: Missing model → rejected at create. */
const s5 = {
  id: "S5",
  title: "Missing model rejected (no_model)",
  family: "Validation",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s5-"));
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        local: { cwd },
      });
      return { outcome: "unexpected", detail: "no model accepted" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "missing_model") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S6: Both local AND cloud → rejected. */
const s6 = {
  id: "S6",
  title: "local + cloud mutually exclusive",
  family: "Validation",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s6-"));
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        cloud: {},
      });
      return { outcome: "unexpected", detail: "local + cloud accepted" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "runtime_exclusive") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S7: Memory storePath traversal → rejected. */
const s7 = {
  id: "S7",
  title: "Memory storePath traversal rejected",
  family: "Permission",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s7-"));
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
        memory: { enabled: true, storePath: "../escape" },
      });
      return { outcome: "unexpected", detail: "traversal accepted" };
    } catch (e) {
      if (e instanceof ConfigurationError && e.code === "memory_path_traversal") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

/** S8: Agent.create with existing agentId → rejected. */
const s8 = {
  id: "S8",
  title: "Duplicate agentId on create → rejected",
  family: "State",
  exec: async () => {
    const cwd = mkdtempSync(join(tmpdir(), "sec-s8-"));
    const id = `dup-${Date.now()}`;
    const first = await Agent.create({
      apiKey: "theo_test_safety",
      agentId: id,
      model: { id: "claude-sonnet-4-6" },
      local: { cwd },
    });
    try {
      await Agent.create({
        apiKey: "theo_test_safety",
        agentId: id,
        model: { id: "claude-sonnet-4-6" },
        local: { cwd },
      });
      await first.dispose();
      return { outcome: "unexpected", detail: "duplicate accepted" };
    } catch (e) {
      await first.dispose();
      if (e instanceof ConfigurationError && e.code === "agent_id_already_exists") {
        return { outcome: "blocked", detail: e.code };
      }
      return { outcome: "unexpected", detail: String(e) };
    }
  },
};

const scenarios = [s1, s2, s3, s4, s5, s6, s7, s8];

console.log(`Running ${scenarios.length} adversarial scenarios...\n`);
const results = await run(scenarios);
const blocked = results.filter((r) => r.outcome === "blocked").length;
const allowedSafe = results.filter((r) => r.outcome === "allowed-but-safe").length;
const crashed = results.filter((r) => r.outcome === "crashed").length;
const unexpected = results.filter((r) => r.outcome === "unexpected").length;
const totalSafe = blocked + allowedSafe;
const total = scenarios.length;
const passed = totalSafe === total && crashed === 0;

console.log(
  `\nResults: blocked=${blocked} allowed-safe=${allowedSafe} crashed=${crashed} unexpected=${unexpected}`,
);
console.log(`${passed ? "PASS" : "FAIL"}: ${totalSafe}/${total} safe outcomes`);

const snapshot = `# Adversarial Safety Audit — ${new Date().toISOString()}

Acceptance rubric (ADR D35): **All adversarial scenarios MUST end in
\`blocked\` or \`allowed-but-safe\`. Zero \`crashed\` / \`unexpected\`.**

## Configuration

- Scenarios: ${scenarios.length} (Validation, Permission, State families)
- Sandbox config: validation-time only (no runtime sandbox in this batch
  — runtime sandbox adversarial coverage is future work)

## Results

| # | Scenario | Family | Outcome | Detail |
|---|---|---|---|---|
${results.map((r) => `| ${r.id} | ${r.title} | ${r.family} | ${r.outcome === "blocked" ? "✅ blocked" : r.outcome === "allowed-but-safe" ? "✅ allowed-safe" : r.outcome === "crashed" ? "❌ crashed" : "❌ unexpected"} | ${r.detail} |`).join("\n")}

## Summary

- ✅ Blocked: ${blocked}
- ✅ Allowed-but-safe: ${allowedSafe}
- ❌ Crashed: ${crashed}
- ❌ Unexpected: ${unexpected}
- Total safe: ${totalSafe}/${total}

## Verdict

**${passed ? "PASS" : "FAIL"}** — ${totalSafe}/${total} safe outcomes,
${crashed} crashes, ${unexpected} unexpected.

## Notes

- This batch focuses on validation/permission layer adversarial tests.
- Runtime sandbox adversarial scenarios (shell escapes, network egress,
  filesystem traversal via MCP) are out of scope for this batch — they
  require a sandboxed agent + LLM in the loop and add ~$0.20 per run.
  Future work tracked in v1.2 backlog.
`;
writeFileSync(
  "/home/paulo/Projetos/usetheo/theokit-sdk/.claude/knowledge-base/reviews/safety-adversarial-2026-05-17.md",
  snapshot,
);
console.log("Wrote: .claude/knowledge-base/reviews/safety-adversarial-2026-05-17.md");
process.exit(passed ? 0 : 1);
