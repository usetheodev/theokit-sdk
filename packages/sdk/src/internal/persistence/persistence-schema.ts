/**
 * Shared Zod schema for the `{ backend: "memory" | "json", dir? }` options
 * used by both `Workflow` snapshots and `Cache` semantic store persistence.
 * Extracted to remove the cross-module clone flagged by jscpd.
 *
 * @internal
 */

import { z } from "zod";

/**
 * `persistence?` opt-in JSON disk backend with `dir` required when chosen.
 *
 * `.refine()` restored after Zod v4-only migration (plan zod-v4-migration
 * T1.1, ADR D4). With single v4 instance across workspace, ZodEffects
 * inside `z.object()` works correctly.
 */
export const PersistenceSchema = z
  .object({
    backend: z.enum(["memory", "json"]),
    dir: z.string().optional(),
  })
  .refine((p) => p.backend !== "json" || (typeof p.dir === "string" && p.dir.length > 0), {
    message: 'persistence.dir is required when backend = "json"',
  })
  .optional();
