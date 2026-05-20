/**
 * Eager registration of builtin providers (T3.3). Side-effect import:
 * importing this module registers the 4 builtins with the registry.
 *
 * Lazy user-plugin discovery is handled by `discovery.ts` (T3.4).
 *
 * @internal
 */

import { registerProvider } from "../registry.js";
import { ANTHROPIC } from "./anthropic.js";
import { GEMINI } from "./gemini.js";
import { OPENAI } from "./openai.js";
import { OPENROUTER } from "./openrouter.js";

let registered = false;

export function registerBuiltins(): void {
  if (registered) return;
  registered = true;
  registerProvider(ANTHROPIC);
  registerProvider(OPENAI);
  registerProvider(OPENROUTER);
  registerProvider(GEMINI);
}

/** Test-only reset. @internal */
export function _resetBuiltinsRegistered(): void {
  registered = false;
}

export { ANTHROPIC, GEMINI, OPENAI, OPENROUTER };
