/**
 * Gateway adapter discovery for `theokit inspect` (T3.1).
 *
 * Unlike LLM providers (registry-based) and embedding adapters (single
 * catalog), gateway adapters live in separate workspace packages
 * (`@theokit/gateway-telegram`, `@theokit/gateway-discord`). We detect
 * presence by attempting to resolve the package; absent = not installed.
 *
 * @internal
 */

import { createRequire } from "node:module";

/** One known gateway and whether this CLI can resolve its package. */
interface GatewayInfo {
  readonly name: string;
  readonly packageName: string;
  readonly installed: boolean;
}

const KNOWN_GATEWAYS = [
  { name: "telegram", packageName: "@theokit/gateway-telegram" },
  { name: "discord", packageName: "@theokit/gateway-discord" },
] as const;

/**
 * Report which gateway packages are resolvable, for the fixed list known to this CLI version.
 *
 * Resolution is relative to THIS module, so it answers "can the CLI see it", which in a hoisted
 * monorepo or a global `npx` install is not the same question as "is it a dependency of the user's
 * project". Never throws and always returns one row per known gateway, `installed: false` included.
 */
export function listGatewayAdapters(): GatewayInfo[] {
  const require = createRequire(import.meta.url);
  return KNOWN_GATEWAYS.map((g) => {
    let installed = false;
    try {
      require.resolve(g.packageName);
      installed = true;
    } catch {
      installed = false;
    }
    return { name: g.name, packageName: g.packageName, installed };
  });
}
