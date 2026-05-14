import { hasContractSignal } from "./contract-signal.js";

const SECRET_KEYS = /(?:api[_-]?key|token|secret|authorization|password|client_secret)/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const UNIX_MS_MIN = 946684800000;

export function normalizeForGolden(value: unknown): unknown {
  return normalizeNode(value, []);
}

function normalizeNode(value: unknown, path: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeNode(item, path));
  }

  if (value instanceof Error) {
    const output: Record<string, unknown> = {
      name: value.name,
      message: normalizeString(value.message),
    };
    for (const [key, child] of Object.entries(value)) {
      output[key] = normalizeNode(child, [...path, key]);
    }
    return output;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (SECRET_KEYS.test(key)) {
        output[key] = "<secret>";
        continue;
      }

      if (
        path.at(-1) === "tool_call" ||
        ((childPath.at(-2) === "tool_call" || path.includes("tool_call")) &&
          (key === "args" || key === "result"))
      ) {
        output[key] = "<unknown>";
        continue;
      }

      if (key === "args" || key === "result") {
        const parent = value as { type?: unknown };
        if (parent.type === "tool_call") {
          output[key] = "<unknown>";
          continue;
        }
      }

      output[key] = normalizeNode(child, childPath);
    }
    return output;
  }

  if (typeof value === "string") {
    return normalizeString(value);
  }

  if (typeof value === "number") {
    const key = path.at(-1) ?? "";
    if (/duration/i.test(key)) return "<duration-ms>";
    if ((/At$/.test(key) || /timestamp/i.test(key)) && value > UNIX_MS_MIN) return "<timestamp>";
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
