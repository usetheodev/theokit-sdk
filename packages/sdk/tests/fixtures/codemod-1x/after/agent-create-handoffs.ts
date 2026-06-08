import { Agent } from "@theokit/sdk";

// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
//   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
//   See docs/migration/1-x-to-2-0.md#budget-tracker
const billing = await Agent.create({ name: "billing", model: { id: "openai/gpt-4o-mini" } });
// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
//   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
//   See docs/migration/1-x-to-2-0.md#budget-tracker
// CODEMOD: handoffs option removed in 2.0 — wrap target agents with Handoff.asPlugin({ targets: [...] }) and pass via plugins array.
//   Before: Agent.create({ handoffs: [a, b] })
//   After:  Agent.create({ plugins: [Handoff.asPlugin({ targets: [a, b] })] })
//   See docs/migration/1-x-to-2-0.md#handoff
const support = await Agent.create({
  name: "support",
  model: { id: "openai/gpt-4o-mini" },
  handoffs: [billing],
});

export { billing, support };
