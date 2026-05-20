import { streamAssistant } from "@usetheo/react";
import { FactCard } from "../../../lib/schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { prompt: string };
  const apiKey =
    process.env.THEOKIT_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    return Response.json(
      { error: "No provider API key in env.", code: "missing_api_key" },
      { status: 401 },
    );
  }
  return streamAssistant({
    apiKey,
    schema: FactCard, // SAME schema export as the client page
    body,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    systemPrompt:
      "You produce a fact card matching the schema exactly. Keep summary 2-3 sentences. Set year to null if unknown.",
  });
}
