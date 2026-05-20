/**
 * Voice / audio transcription via Whisper.
 *
 * Provider order:
 *   1. OPENAI_API_KEY  → OpenAI Whisper (`whisper-1`)
 *   2. GROQ_API_KEY    → Groq Whisper (`whisper-large-v3`)
 *   3. neither         → throw NoTranscriberError so the caller can reply
 *                        with a graceful "voice not configured" message.
 *
 * Telegram voice messages arrive as OGG/Opus. Both Whisper backends accept
 * OGG directly via multipart/form-data.
 *
 * @internal to the example
 */

export class NoTranscriberError extends Error {
  override readonly name = "NoTranscriberError";
  constructor() {
    super(
      "Voice transcription is not configured. Set OPENAI_API_KEY or GROQ_API_KEY in .env to enable it.",
    );
  }
}

interface Transcriber {
  endpoint: string;
  apiKey: string;
  model: string;
  label: "openai" | "groq";
}

function resolveTranscriber(): Transcriber {
  if (process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.length > 0) {
    return {
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      apiKey: process.env.OPENAI_API_KEY,
      model: "whisper-1",
      label: "openai",
    };
  }
  if (process.env.GROQ_API_KEY !== undefined && process.env.GROQ_API_KEY.length > 0) {
    return {
      endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
      apiKey: process.env.GROQ_API_KEY,
      model: "whisper-large-v3",
      label: "groq",
    };
  }
  throw new NoTranscriberError();
}

export interface TranscribeOptions {
  /** Raw audio bytes (OGG/Opus from Telegram, MP3, M4A, etc — Whisper auto-detects). */
  audio: Uint8Array;
  /** Filename hint for the multipart upload. Default `voice.ogg`. */
  filename?: string;
  /** Hint for the model (e.g. "pt", "en"). Default `auto`. */
  languageHint?: string;
}

export interface TranscribeResult {
  text: string;
  provider: "openai" | "groq";
  durationMs: number;
}

export async function transcribeAudio(opts: TranscribeOptions): Promise<TranscribeResult> {
  const transcriber = resolveTranscriber();
  const filename = opts.filename ?? "voice.ogg";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.audio)], { type: "audio/ogg" }), filename);
  form.append("model", transcriber.model);
  form.append("response_format", "json");
  if (opts.languageHint !== undefined && opts.languageHint !== "auto") {
    form.append("language", opts.languageHint);
  }

  const start = Date.now();
  const response = await fetch(transcriber.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${transcriber.apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper ${transcriber.label} returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await response.json()) as { text?: string };
  if (typeof body.text !== "string") {
    throw new Error(`Whisper ${transcriber.label} returned no text field: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return {
    text: body.text.trim(),
    provider: transcriber.label,
    durationMs: Date.now() - start,
  };
}
