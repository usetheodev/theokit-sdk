import { createHash, randomUUID } from "node:crypto";

import type { CustomTool } from "@usetheo/sdk";

/**
 * Ad-hoc tool registry surfaced by the `/tool` slash command.
 *
 * Each entry is a self-contained, dependency-free helper that gets injected
 * per-call via `SendOptions.tools = [...]`. The model only sees the tool
 * relevant to that `/tool <name>` invocation — it can't fall back to `shell`
 * or filesystem MCP, which keeps the contract tight and demonstrates
 * SDK v1.x's per-call tool override semantics.
 *
 * Adding a new tool: append to `AD_HOC_TOOLS`. The `/tool list` command
 * auto-discovers it. No other wiring needed.
 */

interface RollInput {
  count?: number;
  sides?: number;
}

interface Base64Input {
  mode?: "encode" | "decode";
  text?: string;
}

interface HashInput {
  algorithm?: "md5" | "sha1" | "sha256" | "sha512";
  text?: string;
}

interface TimezoneInput {
  tz?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function rollHandler(input: Record<string, unknown>): string {
  const { count, sides } = input as RollInput;
  const n = clampInt(count, 1, 100, 1);
  const s = clampInt(sides, 2, 1000, 6);
  const rolls: number[] = [];
  for (let i = 0; i < n; i += 1) rolls.push(1 + Math.floor(Math.random() * s));
  const total = rolls.reduce((a, b) => a + b, 0);
  return JSON.stringify({ rolls, total, notation: `${n}d${s}` });
}

function uuidHandler(): string {
  return JSON.stringify({ uuid: randomUUID(), version: 4 });
}

function base64Handler(input: Record<string, unknown>): string {
  const { mode, text } = input as Base64Input;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("base64 requires a non-empty `text` field");
  }
  if (mode === "decode") {
    try {
      return JSON.stringify({ mode: "decode", result: Buffer.from(text, "base64").toString("utf8") });
    } catch (cause) {
      throw new Error(`invalid base64 input: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return JSON.stringify({ mode: "encode", result: Buffer.from(text, "utf8").toString("base64") });
}

function hashHandler(input: Record<string, unknown>): string {
  const { algorithm, text } = input as HashInput;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("hash requires a non-empty `text` field");
  }
  const algo = algorithm ?? "sha256";
  if (!["md5", "sha1", "sha256", "sha512"].includes(algo)) {
    throw new Error(`unsupported algorithm "${algo}" — pick md5|sha1|sha256|sha512`);
  }
  return JSON.stringify({ algorithm: algo, digest: createHash(algo).update(text).digest("hex") });
}

function timezoneHandler(input: Record<string, unknown>): string {
  const { tz } = input as TimezoneInput;
  const timeZone = typeof tz === "string" && tz.length > 0 ? tz : "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return JSON.stringify({ timeZone, now: formatter.format(new Date()) });
  } catch (cause) {
    throw new Error(
      `invalid IANA timezone "${timeZone}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export const AD_HOC_TOOLS: Record<string, CustomTool> = {
  uuid: {
    name: "uuid",
    description: "Generate a fresh UUID v4. Takes no arguments.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: uuidHandler,
  },
  roll: {
    name: "roll",
    description:
      "Roll dice. Input { count: 1..100, sides: 2..1000 }. Returns each roll + total. Example: 3d6 → { count: 3, sides: 6 }.",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: 100, description: "Number of dice." },
        sides: { type: "integer", minimum: 2, maximum: 1000, description: "Sides per die." },
      },
      required: ["count", "sides"],
      additionalProperties: false,
    },
    handler: rollHandler,
  },
  base64: {
    name: "base64",
    description:
      'Encode or decode a string with base64. Input { mode: "encode"|"decode" (default encode), text: required }.',
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["encode", "decode"], description: "Direction." },
        text: { type: "string", description: "Input text." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    handler: base64Handler,
  },
  hash: {
    name: "hash",
    description:
      "Compute a cryptographic hash. Input { algorithm: md5|sha1|sha256|sha512 (default sha256), text }.",
    inputSchema: {
      type: "object",
      properties: {
        algorithm: {
          type: "string",
          enum: ["md5", "sha1", "sha256", "sha512"],
          description: "Hash algorithm.",
        },
        text: { type: "string", description: "Input text." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    handler: hashHandler,
  },
  timezone: {
    name: "timezone",
    description:
      'Current local time in any IANA timezone. Input { tz: "America/Sao_Paulo" }. Defaults to UTC.',
    inputSchema: {
      type: "object",
      properties: {
        tz: { type: "string", description: "IANA timezone identifier." },
      },
      additionalProperties: false,
    },
    handler: timezoneHandler,
  },
};

export function listAdHocTools(): string {
  const names = Object.keys(AD_HOC_TOOLS).sort();
  return names.map((n) => `• \`${n}\` — ${AD_HOC_TOOLS[n]?.description ?? ""}`).join("\n");
}
