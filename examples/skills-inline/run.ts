/**
 * Skills — give an agent a code-defined (inline) skill and inspect it. Deterministic: creating the
 * skill + agent and reading agent.skills is local (no LLM). The skill's name+description reach the
 * model's system prompt; its body is fetched on demand via agent.skills.get().
 */
import { Agent, Skill } from "@theokit/sdk";

const shipSkill = Skill.create({
  name: "ship",
  description: "How to deploy this project to production.",
  instructions: "Run the test suite, then `npm run ship`. Never deploy on a red build.",
});

const agent = await Agent.create({
  apiKey: "theo_test_skills",              // fixture key — no LLM
  model: { id: "openai/gpt-4o-mini" },
  skills: { inline: [shipSkill] },
});

const listed = await agent.skills?.list();
console.log("skills:", listed?.map((s) => s.name).join(", "));

const detail = await agent.skills?.get("ship");
console.log("ship description:", detail?.description);
console.log("body loaded?    ", typeof detail?.instructions === "string");

await agent.dispose?.();
