import { hasContractSignal } from "./contract-signal.js";

// Anchored: only redact keys whose FULL name is a secret. `apiKey` redacts;
// `apiKeyName` (a NAME, not a secret) does NOT.
const SECRET_KEYS =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization|password|client[_-]?secret)$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UNIX_MS_MIN = 946684800000;

export function normalizeForGolden(value: unknown): unknown {
  return normalizeNode(value, []);
}

function normalizeNode(value: unknown, path: string[]): unknown {
  if (Array.isArray(value)) return normalizeArray(value, path);
  if (value instanceof Error) return normalizeErrorValue(value, path);
  if (value && typeof value === "object") return normalizeObjectValue(value, path);
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") return normalizeNumberValue(value, path);
  return value;
}

function normalizeArray(value: unknown[], path: string[]): unknown[] {
  return value.map((item) => normalizeNode(item, path));
}

function normalizeErrorValue(value: Error, path: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: value.name,
    message: normalizeString(value.message),
  };
  for (const [key, child] of Object.entries(value)) {
    output[key] = normalizeNode(child, [...path, key]);
  }
  return output;
}

function normalizeObjectValue(value: object, path: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = normalizeObjectEntry(value, key, child, path);
  }
  return output;
}

const TOKEN_COUNT_KEYS = new Set([
  "usedTokens",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
]);

function normalizeObjectEntry(
  parent: object,
  key: string,
  child: unknown,
  path: string[],
): unknown {
  if (SECRET_KEYS.test(key)) return "<secret>";
  if (TOKEN_COUNT_KEYS.has(key)) return "<tokens>";
  const childPath = [...path, key];
  if (isToolCallPayload(parent, key, path, childPath)) return "<unknown>";
  return normalizeNode(child, childPath);
}

function isToolCallPayload(
  parent: object,
  key: string,
  path: string[],
  childPath: string[],
): boolean {
  if (path.at(-1) === "tool_call") return true;
  const isToolPayloadKey = key === "args" || key === "result";
  if (!isToolPayloadKey) return false;
  if (childPath.at(-2) === "tool_call" || path.includes("tool_call")) return true;
  return (parent as { type?: unknown }).type === "tool_call";
}

function normalizeNumberValue(value: number, path: string[]): unknown {
  const key = path.at(-1) ?? "";
  if (/duration/i.test(key)) return "<duration-ms>";
  if ((/At$/.test(key) || /timestamp/i.test(key) || /modified/i.test(key)) && value > UNIX_MS_MIN) {
    return "<timestamp>";
  }
  return value;
}

function normalizeString(value: string): string {
  if (value.length === 0) return value;
  let normalized = value;
  normalized = normalized.replace(/\bagent-[0-9a-fA-F-]{8,}\b/g, "agent-<id>");
  normalized = normalized.replace(/\bbc-[0-9a-fA-F-]{8,}\b/g, "bc-<id>");
  normalized = normalized.replace(/\brun-[0-9a-fA-F-]{8,}\b/g, "run-<id>");
  normalized = normalized.replace(/\brequest-[0-9a-fA-F-]{8,}\b/g, "request-<id>");
  normalized = normalized.replace(/\bcall-[0-9a-fA-F-]{8,}\b/g, "call-<id>");
  normalized = normalized.replace(/\bcron-[0-9a-fA-F-]{8,}\b/g, "cron-<id>");
  normalized = normalized.replace(/feat\/[A-Za-z0-9_-]+/g, "<branch>");
  normalized = normalized.replace(/\/tmp\/[^\s"',)]+/g, "<tmp>");
  normalized = normalized.replace(/\/var\/folders\/[^\s"',)]+/g, "<tmp>");
  normalized = normalized.replace(
    /https:\/\/github\.com\/[^/\s"']+\/[^/\s"']+\/pull\/\d+/g,
    "<pr-url>",
  );
  normalized = normalized.replace(/\b(?:sk|theo|tok)_[A-Za-z0-9_-]{8,}\b/g, "<tokens>");
  if (ISO_TIMESTAMP.test(normalized)) return "<timestamp>";
  return normalized;
}

export function assertGoldenHasContractSignal(value: unknown): void {
  if (!hasContractSignal(value)) {
    throw new Error("Golden value lost all public contract signals during normalization");
  }
}
