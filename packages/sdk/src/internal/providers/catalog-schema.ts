import { z } from "zod";

/**
 * M44 — the per-model catalog sub-schema. Field names mirror models.dev VERBATIM (snake_case) so
 * `scripts/refresh-catalog.mjs` regenerates the vendored data mechanically from `api.json` with zero
 * renaming (ADR D1).
 * TOLERANT by design: every field optional, unknown keys ignored — models.dev adds fields over time and
 * additive drift must never break the loader (Blueprint §6.4).
 *
 * theokit extensions beyond models.dev: `structured_output` / `cache_control` (both already exist on the
 * SDK's `ModelCapabilities`; models.dev has no such flags).
 *
 * @internal
 */

export const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;
export type Modality = (typeof MODALITIES)[number];

const costSchema = z
  .object({
    /** USD per 1M tokens (models.dev convention). */
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cache_read: z.number().nonnegative().optional(),
    cache_write: z.number().nonnegative().optional(),
  })
  .loose();

const limitSchema = z
  .object({
    context: z.number().positive(),
    input: z.number().positive().optional(),
    output: z.number().positive().optional(),
  })
  .loose();

const modalitiesSchema = z
  .object({
    input: z.array(z.enum(MODALITIES)).optional(),
    output: z.array(z.enum(MODALITIES)).optional(),
  })
  .loose();

export const catalogModelSchema = z
  .object({
    name: z.string().optional(),
    release_date: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    temperature: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    /** theokit extension — maps to ModelCapabilities.supportsStructuredOutput. */
    structured_output: z.boolean().optional(),
    /** theokit extension — maps to ModelCapabilities.supportsCacheControl. */
    cache_control: z.boolean().optional(),
    cost: costSchema.optional(),
    limit: limitSchema.optional(),
    modalities: modalitiesSchema.optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
  })
  .loose();

export type CatalogModel = z.infer<typeof catalogModelSchema>;
export type CatalogModelCost = z.infer<typeof costSchema>;
