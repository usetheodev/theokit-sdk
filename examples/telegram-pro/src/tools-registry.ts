import { type CustomTool, defineTool } from "@usetheo/sdk";
import { z } from "zod";

/**
 * Inline custom tools always registered with every Theo Pro agent. Defined
 * via `defineTool` (Zod-driven type-safe builder).
 *
 * `/tool` ad-hoc tools live in `ad-hoc-tools.ts` and are injected per-call via
 * `SendOptions.tools`. The two registries don't overlap.
 */
export const TELEGRAM_PRO_CUSTOM_TOOLS: CustomTool[] = [
  defineTool({
    name: "current_time",
    description:
      "Return the bot host's current UTC time as ISO-8601. Use when the user asks the time, date, or 'que horas são'.",
    inputSchema: z.object({}),
    handler: () => new Date().toISOString(),
  }),
];
