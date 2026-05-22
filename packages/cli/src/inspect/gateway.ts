/**
 * Gateway adapter discovery for `theokit inspect` (T3.1).
 *
 * Unlike LLM providers (registry-based) and embedding adapters (single
 * catalog), gateway adapters live in separate workspace packages
 * (`@usetheo/gateway-telegram`, `@usetheo/gateway-discord`). We detect
 * presence by attempting to resolve the package; absent = not installed.
 *
 * @internal
 */

import { createRequire } from "node:module";

export interface GatewayInfo {
  readonly name: string;
  readonly packageName: string;
  readonly installed: boolean;
}

const KNOWN_GATEWAYS = [
  { name: "telegram", packageName: "@usetheo/gateway-telegram" },
  { name: "discord", packageName: "@usetheo/gateway-discord" },
] as const;

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
