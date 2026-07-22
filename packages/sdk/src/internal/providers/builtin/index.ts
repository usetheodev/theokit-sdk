/**
 * Eager registration of builtin providers (T3.3). Side-effect import:
 * importing this module registers the 4 builtins with the registry.
 *
 * Lazy user-plugin discovery is handled by `discovery.ts` (T3.4).
 *
 * @internal
 */

import { registerCatalogProviders } from "../catalog-loader.js";
import { registerProvider } from "../registry.js";
import { ANTHROPIC } from "./anthropic.js";
import { BEDROCK } from "./bedrock.js";
import { CEREBRAS } from "./cerebras.js";
import { COHERE } from "./cohere.js";
import { DEEPINFRA } from "./deepinfra.js";
import { GOOGLE } from "./google.js";
import { GROQ } from "./groq.js";
import { MISTRAL } from "./mistral.js";
import { PERPLEXITY } from "./perplexity.js";
import { TOGETHER } from "./together.js";
import { XAI } from "./xai.js";
import { GEMINI } from "./gemini.js";
import { LLAMACPP } from "./llamacpp.js";
import { LMSTUDIO } from "./lmstudio.js";
import { OLLAMA } from "./ollama.js";
import { OPENAI } from "./openai.js";
import { OPENAI_CHATGPT } from "./openai-chatgpt.js";
import { OPENROUTER } from "./openrouter.js";
import { VERTEX } from "./vertex.js";

let registered = false;

export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  // First-party builtins (take priority — registered first)
  registerProvider(ANTHROPIC);
  registerProvider(OPENAI);
  registerProvider(OPENAI_CHATGPT);
  registerProvider(OPENROUTER);
  registerProvider(GEMINI);
  registerProvider(OLLAMA);
  registerProvider(LMSTUDIO);
  registerProvider(LLAMACPP);
  registerProvider(BEDROCK);
  registerProvider(VERTEX);
  // M45 — the data-provider fleet (one file each on the openai-compatible base).
  registerProvider(GOOGLE);
  registerProvider(MISTRAL);
  registerProvider(GROQ);
  registerProvider(COHERE);
  registerProvider(DEEPINFRA);
  registerProvider(TOGETHER);
  registerProvider(XAI);
  registerProvider(PERPLEXITY);
  registerProvider(CEREBRAS);
  // Dynamic catalog — 40+ providers from JSON (T10.1, ADR D447)
  registerCatalogProviders();
}

/** Test-only reset. @internal */
export function _resetBuiltinsRegistered(): void {
  registered = false;
}

export {
  ANTHROPIC,
  BEDROCK,
  GEMINI,
  LLAMACPP,
  LMSTUDIO,
  OLLAMA,
  OPENAI,
  OPENAI_CHATGPT,
  OPENROUTER,
  VERTEX,
};
