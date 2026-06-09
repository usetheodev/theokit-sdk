/**
 * VoiceProvider interface — foundation for TTS/STT adapters (T12.3).
 * @public @experimental
 */

export interface TTSOptions {
  model?: string;
  voice?: string;
  speed?: number;
  format?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
}

export interface STTOptions {
  model?: string;
  language?: string;
  prompt?: string;
}

export interface TTSResult {
  audio: Buffer | Uint8Array;
  format: string;
  durationMs?: number;
}

export interface STTResult {
  text: string;
  language?: string;
  durationMs?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface VoiceProvider {
  readonly name: string;
  textToSpeech(text: string, opts?: TTSOptions): Promise<TTSResult>;
  speechToText(audio: Buffer | Uint8Array, opts?: STTOptions): Promise<STTResult>;
}
