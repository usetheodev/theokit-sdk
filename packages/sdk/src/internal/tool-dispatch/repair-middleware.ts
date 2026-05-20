/**
 * Tool-call repair middleware (T1.1, ADR D87).
 *
 * Applies 3 idempotent repairs sequentially before tool dispatch:
 *   1. Case-insensitive name match (ADR D88 — no fuzzy match)
 *   2. JSON-string args → object parse
 *   3. Type coercion against JSON Schema (string → number/integer/boolean/object)
 *
 * Fixes 10+ provider-specific failure modes catalogued in
 * `.claude/knowledge-base/sdk-references/tool-call-failure-recovery.md`:
 * Hermes v0.2 #444 (DeepSeek JSON), v0.3 #1300 (parallel calls),
 * v0.8 #5265 (type coerce), and similar.
 *
 * NOTE on coerce limits (EC-9): regex `^-?\d+(\.\d+)?$` accepts decimal
 * notation only — scientific (`1e5`), hex (`0xFF`), and `Infinity` are
 * preserved as strings and rejected by downstream schema validation. KISS:
 * 99% of provider-emitted tool args use plain decimal.
 *
 * @internal
 */

export interface ToolCall {
  name: string;
  args: unknown;
  id: string;
}

export interface RepairableTool {
  name: string;
  /** JSON Schema for the tool's input. `properties` map drives coercion. */
  inputSchema: Record<string, unknown>;
}

export interface RepairResult {
  call: ToolCall;
  /** Human-readable log of repairs applied (empty when no-op). */
  repairs: string[];
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Apply idempotent repairs to a raw tool call from an LLM. Pure function:
 * does NOT mutate `raw` or `registry`. Runs in O(registry.size) for the
 * name lookup; O(properties.length) for coercion.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 3 sequential repair stages (name match / args parse / type coerce) live in one function by design — splitting them hides the repair order (ADR D87) that callers reason about via the `repairs` log.
export function repairToolCall(
  raw: ToolCall,
  registry: ReadonlyMap<string, RepairableTool>,
): RepairResult {
  const repairs: string[] = [];
  let call: ToolCall = { ...raw };

  // Repair 1: case-insensitive name match. NEVER fuzzy (Hermes posture,
  // ADR D88) — typos get rejected downstream with available-tools list.
  if (!registry.has(call.name)) {
    const lower = call.name.toLowerCase();
    let match: string | undefined;
    for (const key of registry.keys()) {
      if (key.toLowerCase() === lower) {
        match = key;
        break;
      }
    }
    if (match !== undefined) {
      repairs.push(`name: "${call.name}" → "${match}"`);
      call = { ...call, name: match };
    }
  }

  // Repair 2: JSON-string args → object. Some providers stringify args
  // (DeepSeek v0.2 #444, Anthropic intermittently).
  if (typeof call.args === "string") {
    try {
      const parsed = JSON.parse(call.args);
      call = { ...call, args: parsed };
      repairs.push("args: parsed from string");
    } catch {
      // Leave as string for downstream validator to reject.
    }
  }

  // Repair 3: type coercion against schema (Hermes v0.8 #5265).
  const tool = registry.get(call.name);
  if (
    tool !== undefined &&
    typeof call.args === "object" &&
    call.args !== null &&
    !Array.isArray(call.args)
  ) {
    const coerced = coerceArgsToSchema(call.args as Record<string, unknown>, tool.inputSchema);
    if (coerced.changed.length > 0) {
      call = { ...call, args: coerced.value };
      repairs.push(...coerced.changed);
    }
  }

  return { call, repairs };
}

export interface CoerceResult {
  value: Record<string, unknown>;
  changed: string[];
}

/**
 * Coerce string-typed args to the schema's declared type. Supports
 * `number`, `integer`, `boolean`, `array`, `object`. Scientific notation,
 * hex, and `Infinity` are out of scope (EC-9 documented limitation).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 5-type coercion ladder (number / integer / boolean / array / object) is exhaustive by design — JSON Schema type taxonomy maps 1:1 to branch arms.
export function coerceArgsToSchema(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): CoerceResult {
  const changed: string[] = [];
  const out: Record<string, unknown> = { ...args };
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (properties === undefined) return { value: out, changed };

  for (const [key, propDef] of Object.entries(properties)) {
    const val = out[key];
    if (typeof val !== "string") continue;
    const propType = (propDef as { type?: unknown }).type;
    if (typeof propType !== "string") continue;

    if (propType === "number" && DECIMAL_RE.test(val.trim())) {
      out[key] = Number(val);
      changed.push(`${key}: string→number`);
    } else if (propType === "integer" && /^-?\d+$/.test(val.trim())) {
      out[key] = Number(val);
      changed.push(`${key}: string→integer`);
    } else if (propType === "boolean" && (val === "true" || val === "false")) {
      out[key] = val === "true";
      changed.push(`${key}: string→boolean`);
    } else if (propType === "array" || propType === "object") {
      try {
        const parsed = JSON.parse(val);
        if (propType === "array" && Array.isArray(parsed)) {
          out[key] = parsed;
          changed.push(`${key}: string→array`);
        } else if (
          propType === "object" &&
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          out[key] = parsed;
          changed.push(`${key}: string→object`);
        }
      } catch {
        // Not JSON — leave as string for validator.
      }
    }
  }

  return { value: out, changed };
}
