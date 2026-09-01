/**
 * M23 — schema normalizer: convert a schema from any supported provider to the internal JSON Schema
 * the synthetic `output` tool uses. Zod stays the DEFAULT and the documented recommendation; this is
 * a THIN adapter with no deep coupling (ADR-0041). Supported inputs:
 *
 *  - **Zod** (default)     — via the SDK's native `z.toJSONSchema` path.
 *  - **JSON Schema**       — a plain object with `type`/`properties` (or `$schema`) → passthrough.
 *  - **ArkType**           — any schema exposing `.toJsonSchema()` (ArkType 2.0) → called directly.
 *  - **Valibot**           — via the OPTIONAL `@valibot/to-json-schema` peer (dynamic import; a clear
 *                            error tells the user to install it — no hard dependency).
 *
 * Parse-failure handling stays uniform: the normalized JSON Schema drives the same synthetic-tool
 * validation + M14 `errorStrategy` regardless of the source library.
 */
import { toJsonSchema } from "./internal/zod-to-json-schema.js";

/** The internal JSON-Schema shape the synthetic `output` tool consumes. */
export type NormalizedJsonSchema = Record<string, unknown>;

/** A plain JSON Schema object already in the target shape. */
function isJsonSchemaObject(s: unknown): s is NormalizedJsonSchema {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  if ("$schema" in o) return true;
  return o.type === "object" && typeof o.properties === "object" && o.properties !== null;
}

/** ArkType (and any lib) exposing its own `.toJsonSchema()`. */
function hasToJsonSchemaMethod(s: unknown): s is { toJsonSchema: () => NormalizedJsonSchema } {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as { toJsonSchema?: unknown }).toJsonSchema === "function"
  );
}

/** A Zod schema — carries `safeParse` plus the Zod internals (`_def` v3 / `def` v4). */
function isZodSchema(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return typeof o.safeParse === "function" && ("_def" in o || "def" in o);
}

/** A Valibot schema — `{ kind: 'schema', type, ... }` (no built-in JSON-Schema method). */
function isValibotSchema(s: unknown): boolean {
  if (typeof s !== "object" || s === null) return false;
  const o = s as Record<string, unknown>;
  return o.kind === "schema" && "type" in o && typeof o.toJsonSchema !== "function";
}

/**
 * Normalize any supported schema to the internal JSON Schema. Async because the Valibot path
 * dynamically imports its optional converter. Throws a clear, typed-message error for an unsupported
 * schema or a missing Valibot peer (error-handling.md).
 */
export async function normalizeSchema(schema: unknown): Promise<NormalizedJsonSchema> {
  // JSON Schema — passthrough (already the target shape).
  if (isJsonSchemaObject(schema)) return schema;

  // Valibot — needs its own converter (optional peer). Import via a NON-literal specifier so TS does
  // not try to statically resolve the (uninstalled) optional peer at build time.
  if (isValibotSchema(schema)) {
    const specifier = "@valibot/to-json-schema";
    try {
      const mod = (await import(specifier)) as {
        toJsonSchema: (s: unknown) => NormalizedJsonSchema;
      };
      return mod.toJsonSchema(schema);
    } catch (err) {
      const missing =
        err instanceof Error && /Cannot find|Cannot resolve|ERR_MODULE_NOT_FOUND/.test(err.message);
      if (missing) {
        throw new Error(
          "normalizeSchema: a Valibot schema requires the optional '@valibot/to-json-schema' package. " +
            "Install it, or use a Zod schema (the default recommendation).",
        );
      }
      throw err;
    }
  }

  // Zod — the default path.
  if (isZodSchema(schema)) {
    return toJsonSchema(schema as never, { unrepresentable: "any" }) as NormalizedJsonSchema;
  }

  // ArkType (or any lib exposing `.toJsonSchema()`).
  if (hasToJsonSchemaMethod(schema)) return schema.toJsonSchema();

  throw new Error(
    "normalizeSchema: unsupported schema. Supported: Zod (default), JSON Schema, ArkType (.toJsonSchema()), " +
      "Valibot (with @valibot/to-json-schema).",
  );
}
