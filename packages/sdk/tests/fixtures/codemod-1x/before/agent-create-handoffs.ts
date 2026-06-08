import { Agent } from "@theokit/sdk";

const billing = await Agent.create({ name: "billing", model: { id: "openai/gpt-4o-mini" } });
const support = await Agent.create({
  name: "support",
  model: { id: "openai/gpt-4o-mini" },
  handoffs: [billing],
});

export { billing, support };
