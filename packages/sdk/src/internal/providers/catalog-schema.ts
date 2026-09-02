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
 * Semver-exempt: nothing here is declared in `package.json` `exports`. `MODALITIES` is nonetheless
 * reachable from published declarations through the type graph, so it must be EMITTED.
 *
 * NOTE — no internal-visibility tag in this block. `tsconfig.base.json` sets `stripInternal: true`,
 * and TypeScript scans EVERY leading comment range of the declaration that follows; the tag that
 * used to sit here deleted the `MODALITIES` declaration below from the emitted `.d.ts`.
 */

export const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;

/**
 * One input or output medium a model accepts or produces.
 *
 * The union is derived from `MODALITIES`, so it is closed: a models.dev entry whose
 * `modalities.input` or `modalities.output` array contains a string outside this set fails
 * `catalogModelSchema.safeParse`, and `patchIndexFromApiJson` drops that single model rather
 * than the whole payload. Widening the catalog to a new medium means adding it to `MODALITIES`
 * first — nothing else in the schema enumerates media.
 */
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

/**
 * One model entry as it is stored in the vendored catalog and as models.dev publishes it.
 *
 * Every field is optional, so an entry that carries only `name` still parses. Reading a value
 * therefore means handling `undefined` at each level — `model.cost?.cache_read`, not
 * `model.cost.cache_read`. Field names are models.dev's own snake_case, kept verbatim so the
 * refresh script can copy `api.json` across without renaming.
 *
 * The schema is loose rather than strict: unknown keys survive parsing and stay on the returned
 * object instead of being rejected or dropped. That is what lets models.dev add a field without
 * breaking the loader — the cost is that a typo in a key name parses silently, so a caller
 * cannot use "it parsed" as evidence that a field it expected was present.
 *
 * `structured_output` and `cache_control` are theokit's own additions; models.dev publishes
 * neither.
 */
export type CatalogModel = z.infer<typeof catalogModelSchema>;

/**
 * Per-token pricing for one model, in USD per 1M tokens (models.dev's unit — not per token, and
 * not per 1K).
 *
 * `input` and `output` are required and non-negative; the two cache buckets are optional and
 * absent for models that do not price caching separately. Absent is not zero: a missing
 * `cache_read` means the catalog says nothing about the cost of a cache hit, so a caller that
 * defaults it to 0 is asserting free cache reads on its own authority.
 *
 * Like `CatalogModel`, the shape is loose — unknown pricing keys published upstream are kept on
 * the parsed value.
 */
export type CatalogModelCost = z.infer<typeof costSchema>;

/**
 * One provider entry in the vendored catalog.
 *
 * LOOSE like `catalogModelSchema` beside it, and for the same reason: this validates a vendored data
 * file that upstream extends over time, so unknown keys are kept rather than rejected. What it does
 * NOT do is what the hand-rolled check it replaced did — assert. That check tested nine fields with
 * `typeof`/`Array.isArray` and then cast the whole object through `as unknown as CatalogEntry`, so
 * `capabilities`' contents, `aliases`, `modelsUrl`, `hostname`, `extraHeaders` and `models` were
 * declared and never checked. Standing next to zod — one of this package's three runtime
 * dependencies — and reimplementing a worse version of it is the Don't-Reinvent rung of
 * `rules/parsimony-ladder.md`.
 *
 * `apiMode` and `authType` are the closed unions from `types/provider-profile.ts`. Enumerating them
 * here means an entry naming a mode the SDK cannot dispatch is dropped with a WARN at load, instead
 * of reaching `selectTransport` as a string that matches no branch.
 */
export const catalogEntrySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    apiMode: z.enum([
      "chat_completions",
      "anthropic_messages",
      "responses_api",
      "bedrock",
      "bedrock_anthropic",
    ]),
    authType: z.enum([
      "api_key",
      "oauth_device_code",
      "oauth_external",
      "aws_sdk",
      "aws_bearer",
      "gcp_oauth",
      "none",
    ]),
    baseUrl: z.string(),
    envVars: z.array(z.string()),
    fallbackModels: z.array(z.string()),
    capabilities: z.object({
      supportsToolUse: z.boolean(),
      supportsVision: z.boolean(),
      supportsStructuredOutput: z.boolean(),
      supportsStreaming: z.boolean(),
      supportsCacheControl: z.boolean(),
      maxContextTokens: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
    }),
    aliases: z.array(z.string()).optional(),
    modelsUrl: z.string().optional(),
    hostname: z.string().optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),
    models: z.record(z.string(), catalogModelSchema).optional(),
  })
  .loose();
