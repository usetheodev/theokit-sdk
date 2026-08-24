/**
 * Ambient declaration for the preflight ESM script.
 * Matches the exports in preflight-native-bindings.mjs.
 *
 * NAMED IN `knip.json`'s ignore list, and this is why. A `.d.mts` sidecar has no importer of its
 * own — TypeScript picks it up by filename when something imports the `.mjs` beside it, which
 * `packages/sdk/vitest.setup.ts:49` does. `knip` resolves imports and sees no edge into this file,
 * so it reports it as an unused FILE. Measured 2026-08-20: dropping the ignore produces exactly
 * that one finding, and the file is plainly used.
 *
 * The reason lives here rather than only in the config because an ignore entry with nothing at the
 * site reads exactly like a suppressed real finding — which is how this repo shipped a dead-code
 * gate that examined almost nothing (#343-adjacent, see CONTRIBUTING "A blanket suppression is a
 * claim about the tool"). If the `.mjs` is ever converted to TypeScript, delete this file AND its
 * ignore entry together.
 */
export function findRebuildCwd(
  failingBindingPath: string | undefined,
  defaultCwd: string,
): string;
export function ensureNativeBindings(): Promise<void>;
