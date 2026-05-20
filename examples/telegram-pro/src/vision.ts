import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Sticker / photo description via Gemini-2.0-flash multimodal.
 *
 * OpenRouter exposes `google/gemini-2.0-flash-001` with vision capability:
 * we POST the image as base64 in the chat-completions `content` array. The
 * model returns a short description we feed into the agent loop.
 *
 * **Cache** — sticker IDs are stable in Telegram (file_unique_id), so we
 * cache the LLM description to `.theokit/cache/vision/<sha>.txt`. Repeated
 * stickers (especially common in groups) avoid a re-roundtrip to the LLM.
 *
 * @internal to the example
 */

const VISION_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const VISION_MODEL = "google/gemini-2.0-flash-001";

export interface DescribeOptions {
  /** Raw image bytes (JPEG/PNG/WebP). */
  image: Uint8Array;
  /** MIME hint. Default `image/jpeg`. */
  mime?: string;
  /** Stable id for caching (e.g. Telegram file_unique_id). When omitted,
   * the SHA-256 of the bytes is used (slower but still works). */
  cacheKey?: string;
  /** Workspace cwd — cache lives at `<cwd>/.theokit/cache/vision/`. */
  cwd: string;
  /** Prompt nudge for the model. Default focuses on user intent. */
  prompt?: string;
}

export interface DescribeResult {
  description: string;
  cached: boolean;
  durationMs: number;
}

const DEFAULT_PROMPT =
  "Describe this image in 1-2 short sentences. If it's a sticker, name the emotion / theme. Be specific.";

function cachePath(cwd: string, sha: string): string {
  return join(cwd, ".theokit", "cache", "vision", `${sha}.txt`);
}

async function readCache(cwd: string, sha: string): Promise<string | undefined> {
  try {
    return await readFile(cachePath(cwd, sha), "utf8");
  } catch {
    return undefined;
  }
}

async function writeCache(cwd: string, sha: string, value: string): Promise<void> {
  const path = cachePath(cwd, sha);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export async function describeImage(opts: DescribeOptions): Promise<DescribeResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENROUTER_API_KEY required for vision. Set it in .env.");
  }
  const sha =
    opts.cacheKey ?? createHash("sha256").update(new Uint8Array(opts.image)).digest("hex");
  const hit = await readCache(opts.cwd, sha);
  if (hit !== undefined) {
    return { description: hit, cached: true, durationMs: 0 };
  }
  const mime = opts.mime ?? "image/jpeg";
  const dataUrl = `data:${mime};base64,${Buffer.from(opts.image).toString("base64")}`;
  const body = {
    model: VISION_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt ?? DEFAULT_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 200,
  };
  const start = Date.now();
  const response = await fetch(VISION_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vision API returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (text.length === 0) {
    throw new Error(`Vision API returned empty content: ${JSON.stringify(json).slice(0, 200)}`);
  }
  await writeCache(opts.cwd, sha, text);
  return { description: text, cached: false, durationMs: Date.now() - start };
}
