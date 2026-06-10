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
 */
/**
 * `persistence?` opt-in JSON disk backend with `dir` required when chosen.
 *
 * Plain `z.object().optional()` without refinement — Zod v4 rejects
 * `ZodEffects` wrappers (`.refine()`/`.superRefine()`) when nested inside
 * another `z.object()` property. The dir-required-when-json constraint is
 * enforced at runtime by callers (`Cache.semantic`, `Workflow.create`).
 */
export const PersistenceSchema = z
  .object({
    backend: z.enum(["memory", "json"]),
    dir: z.string().optional(),
  })
  .optional();
