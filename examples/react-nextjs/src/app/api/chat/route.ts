import { streamTheoChat } from "@usetheo/react";
import { getAgent } from "../../../lib/get-agent";

export const runtime = "nodejs"; // Memory + SDK need full Node runtime, not edge.

export async function POST(req: Request) {
  const body = (await req.json()) as {
    agentId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const agent = await getAgent(body.agentId);
  return streamTheoChat({ agent, body });
}
