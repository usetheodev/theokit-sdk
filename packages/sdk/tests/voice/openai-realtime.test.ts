import { describe, expect, it } from "vitest";
import { OpenAIRealtimeVoiceProvider } from "../../src/voice/openai-realtime.js";
import type { VoiceProvider } from "../../src/voice/types.js";

describe("OpenAI Realtime Voice Provider", () => {
  it("implements VoiceProvider interface", () => {
    const provider: VoiceProvider = new OpenAIRealtimeVoiceProvider({ apiKey: "test-key" });
    expect(typeof provider.textToSpeech).toEqual("function");
    expect(typeof provider.speechToText).toEqual("function");
    expect(provider.name).toEqual("openai-realtime");
  });

  it("has correct name property", () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: "test" });
    expect(provider.name).toEqual("openai-realtime");
  });

  it("textToSpeech is an async function", () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: "test" });
    expect(typeof provider.textToSpeech).toEqual("function");
  });

  it("speechToText is an async function", () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: "test" });
    expect(typeof provider.speechToText).toEqual("function");
  });

  it("accepts custom baseUrl", () => {
    const provider = new OpenAIRealtimeVoiceProvider({
      apiKey: "test",
      baseUrl: "http://localhost:8080/v1",
    });
    expect(provider).toBeDefined();
  });
});
