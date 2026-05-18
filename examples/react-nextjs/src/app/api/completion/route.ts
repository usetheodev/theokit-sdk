import { streamCompletion } from "@usetheo/react";
import { getAgent } from "../../../lib/get-agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { prompt: string };
  const agent = await getAgent("demo-web-completion");
  return streamCompletion({ agent, body });
}
