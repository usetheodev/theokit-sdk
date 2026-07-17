---
user-invocable: false
description: Clean model-emitted tool arguments with sanitizeToolInput from @theokit/sdk/sanitize (total, never throws).
paths:
  - "**/*sanitize*"
  - "**/*Sanitize*"
---

# TheoKit SDK -- Sanitize

`sanitizeToolInput` cleans the raw arguments a model emitted for a tool call: trim (default on), optionally coerce string values toward their expected type, optionally repair malformed JSON. It is pure, synchronous, and TOTAL -- it NEVER throws (non-object input is returned unchanged) and never changes a value's meaning, only its hygiene/representation.

## Import

```typescript
import { sanitizeToolInput } from "@theokit/sdk/sanitize";
import type { SanitizeOptions, SanitizeResult } from "@theokit/sdk/sanitize";
```

## Signature

```typescript
function sanitizeToolInput(
  input: Record<string, unknown>,
  options?: SanitizeOptions,
): SanitizeResult;

interface SanitizeOptions {
  trim?: boolean;        // trim whitespace on string values. Default true
  coerce?: boolean;      // "5"->5, "true"->true, "null"->null, JSON. Default false
  repairJson?: boolean;  // repair-then-parse malformed JSON strings (jsonrepair). Default false
  schema?: ZodType;      // when a z.object(...), coercion is schema-aware per top-level field
  deep?: boolean;        // recurse into nested objects/arrays. Default false (shallow)
  maxDepth?: number;     // max recursion depth when deep. Default 8
}

interface SanitizeResult<T = Record<string, unknown>> {
  value: T;          // the sanitized copy
  changed: boolean;  // true when any value was altered
  notes: string[];   // one human-readable line per change (for logging)
}
```

## Trim only (default)

```typescript
const { value, changed, notes } = sanitizeToolInput({ query: "  hello  " });
// value -> { query: "hello" }, changed -> true, notes -> ["query: trimmed whitespace"]
```

## Schema-aware coercion inside a tool handler

Pass the tool's Zod object schema so a `z.string()` field keeps `"5"` as a string while a `z.number()` field coerces it. Never throws, so it is safe to run before `schema.parse`.

```typescript
import { z } from "zod";

const inputSchema = z.object({ count: z.number(), label: z.string() });

const { value } = sanitizeToolInput(
  { count: "5", label: "42" },
  { coerce: true, schema: inputSchema },
);
// value -> { count: 5, label: "42" }  (label stays a string; count coerced)
const parsed = inputSchema.parse(value);
```
