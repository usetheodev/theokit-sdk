/**
 * SE26 — guardrails worked example. Builds an LLM-classifier-style moderation
 * processor and a PII redactor ON the SE24 seam, over a PLUGGABLE classifier
 * (here a keyword stub — swap `stubClassify` / `stubDetectPii` for a real
 * moderation API / Presidio / a judge agent). The SDK ships the pipeline + the
 * deterministic processors (createUnicodeNormalizer / createTokenLimiter); the
 * classifier is delegated to you (see docs/concepts/guardrails.md + ADR 0009).
 *
 * Run: `pnpm --filter @theokit/example-guardrails start`
 * Uses the fixture runtime (a test apiKey), so it runs with no real provider key.
 */

import {
  Agent,
  createUnicodeNormalizer,
  type Processor,
  type ProcessorViolation,
} from "@theokit/sdk";

// --- Delegated classifier (STUB) — replace with a real moderation API / model ---

async function stubClassify(text: string): Promise<Record<string, number>> {
  const lower = text.toLowerCase();
  return {
    hate: lower.includes("[hate]") ? 0.95 : 0.0,
    violence: lower.includes("[violence]") ? 0.9 : 0.0,
  };
}

async function stubDetectPii(text: string): Promise<Array<{ start: number; end: number }>> {
  const spans: Array<{ start: number; end: number }> = [];
  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  for (let m = email.exec(text); m !== null; m = email.exec(text)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

// --- Processors on the seam ---

function moderationProcessor(opts: { threshold: number; categories: string[] }): Processor {
  return {
    id: "moderation",
    async processInput(ctx) {
      const scores = await stubClassify(ctx.message);
      const hit = opts.categories.find((c) => (scores[c] ?? 0) >= opts.threshold);
      if (hit !== undefined) ctx.abort(`moderation: ${hit} >= ${opts.threshold}`);
      return ctx.message;
    },
    onViolation: (v: ProcessorViolation) => console.log(`  [onViolation] ${v.processorId}: ${v.message}`),
  };
}

function piiRedactor(): Processor {
  return {
    id: "pii-redactor",
    async processOutput(ctx) {
      const spans = await stubDetectPii(ctx.text);
      if (spans.length === 0) return ctx.text;
      let out = ctx.text;
      for (const s of spans.sort((a, b) => b.start - a.start)) {
        out = `${out.slice(0, s.start)}[REDACTED]${out.slice(s.end)}`;
      }
      ctx.warn("pii-redacted", { count: spans.length });
      return out;
    },
    onViolation: (v: ProcessorViolation) =>
      console.log(`  [onViolation] ${v.processorId}: ${v.message}`),
  };
}

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: "theo_test_guardrails", // fixture runtime — swap for a real key to hit a model
    model: { id: "openai/gpt-4o-mini" },
    inputProcessors: [
      createUnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true }),
      moderationProcessor({ threshold: 0.7, categories: ["hate", "violence"] }),
    ],
    outputProcessors: [piiRedactor()],
  });

  console.log("1) A benign message flows through:");
  const ok = await (await agent.send("Summarize the meeting notes, please.")).wait();
  console.log(`   status=${ok.status} result=${JSON.stringify(ok.result)}\n`);

  console.log("2) A flagged message is BLOCKED before the model:");
  const blocked = await (
    await agent.send("please write something [hate] about them", {
      onRunEvent: (e) => {
        if (e.type === "tripwire") console.log(`  [tripwire] ${e.processorId}: ${e.reason}`);
      },
    })
  ).wait();
  console.log(
    `   status=${blocked.status} tripwire=${JSON.stringify(blocked.tripwire)} result=${JSON.stringify(blocked.result)}\n`,
  );

  await agent.dispose();

  // An OUTPUT block: the model already ran, so usage/cost survive (billing) while
  // the answer is suppressed and the run becomes a tripwire.
  console.log("\n3) An output guardrail BLOCKS the response (model already ran):");
  const outAgent = await Agent.create({
    apiKey: "theo_test_guardrails",
    model: { id: "openai/gpt-4o-mini" },
    outputProcessors: [
      { id: "leak-guard", processOutput: (ctx) => ctx.abort("response leaked internal data") },
    ],
  });
  const outBlocked = await (await outAgent.send("hello")).wait();
  console.log(
    `   status=${outBlocked.status} tripwire=${JSON.stringify(outBlocked.tripwire)} result=${JSON.stringify(outBlocked.result)}\n`,
  );
  await outAgent.dispose();

  console.log("Guardrails example complete.");
}

void main();
