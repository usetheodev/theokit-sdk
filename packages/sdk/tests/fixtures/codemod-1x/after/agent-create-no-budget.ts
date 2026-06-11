import { Agent } from "@theokit/sdk";

// CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.
//   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.
//   See docs/migration/1-x-to-2-0.md#budget-tracker
const agent = await Agent.create({ name: "x", model: { id: "openai/gpt-4o-mini" } });

export { agent };
