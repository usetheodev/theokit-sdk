import { Agent } from "@theokit/sdk";

const agent = await Agent.create({ name: "x", model: { id: "openai/gpt-4o-mini" } });

export { agent };
