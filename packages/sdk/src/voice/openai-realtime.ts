/**
 * OpenAI Realtime voice provider — TTS via OpenAI Audio API (T12.3).
 *
 * Optional peer dep: none (uses native fetch).
 *
 * @public @experimental
 */

import type { STTOptions, STTResult, TTSOptions, TTSResult, VoiceProvider } from "./types.js";

export interface OpenAIRealtimeVoiceProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIRealtimeVoiceProvider implements VoiceProvider {
  readonly name = "openai-realtime";
  private readonly _apiKey: string;
  private readonly _baseUrl: string;

  constructor(opts: OpenAIRealtimeVoiceProviderOptions) {
    this._apiKey = opts.apiKey;
    this._baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  }

  async textToSpeech(text: string, opts?: TTSOptions): Promise<TTSResult> {
    const response = await fetch(`${this._baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts?.model ?? "tts-1",
        input: text,
        voice: opts?.voice ?? "alloy",
        response_format: opts?.format ?? "mp3",
        speed: opts?.speed ?? 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      format: opts?.format ?? "mp3",
    };
  }

  async speechToText(audio: Buffer | Uint8Array, opts?: STTOptions): Promise<STTResult> {
    const formData = new FormData();
    formData.append("file", new Blob([audio]), "audio.wav");
    formData.append("model", opts?.model ?? "whisper-1");
    if (opts?.language) formData.append("language", opts.language);
    if (opts?.prompt) formData.append("prompt", opts.prompt);
    formData.append("response_format", "verbose_json");

    const response = await fetch(`${this._baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this._apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      text: string;
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: data.text,
      language: data.language,
      durationMs: data.duration ? data.duration * 1000 : undefined,
      segments: data.segments,
    };
  }
}
