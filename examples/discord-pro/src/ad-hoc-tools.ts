import { createHash, randomUUID } from "node:crypto";

import { type CustomTool, defineTool } from "@usetheo/sdk";
import { z } from "zod";

/**
 * Ad-hoc tool registry surfaced by the `/tool` slash command.
 *
 * Each entry is built via `defineTool` (Zod-driven type-safe builder, ADR D24).
 * Handlers receive typed input — no `as` casts, runtime validation comes
 * from Zod automatically.
 *
 * Adding a new tool: append to `AD_HOC_TOOLS`. The `/tool list` command
 * auto-discovers it. No other wiring needed.
 */

const rollSchema = z.object({
  count: z.number().int().min(1).max(100).describe("Number of dice."),
  sides: z.number().int().min(2).max(1000).describe("Sides per die."),
});

const base64Schema = z.object({
  mode: z.enum(["encode", "decode"]).default("encode").describe("Direction."),
  text: z.string().min(1).describe("Input text."),
});

const hashSchema = z.object({
  algorithm: z.enum(["md5", "sha1", "sha256", "sha512"]).default("sha256"),
  text: z.string().min(1).describe("Input text."),
});

const timezoneSchema = z.object({
  tz: z.string().min(1).default("UTC").describe("IANA timezone identifier."),
});

export const AD_HOC_TOOLS: Record<string, CustomTool> = {
  uuid: defineTool({
    name: "uuid",
    description: "Generate a fresh UUID v4. Takes no arguments.",
    inputSchema: z.object({}),
    handler: () => JSON.stringify({ uuid: randomUUID(), version: 4 }),
  }),
  roll: defineTool({
    name: "roll",
    description:
      "Roll dice. Input { count: 1..100, sides: 2..1000 }. Returns each roll + total. Example: 3d6 → { count: 3, sides: 6 }.",
    inputSchema: rollSchema,
    handler: ({ count, sides }) => {
      const rolls: number[] = [];
      for (let i = 0; i < count; i += 1) rolls.push(1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return JSON.stringify({ rolls, total, notation: `${count}d${sides}` });
    },
  }),
  base64: defineTool({
    name: "base64",
    description:
      'Encode or decode a string with base64. Input { mode: "encode"|"decode" (default encode), text: required }.',
    inputSchema: base64Schema,
    handler: ({ mode, text }) => {
      if (mode === "decode") {
        try {
          return JSON.stringify({
            mode: "decode",
            result: Buffer.from(text, "base64").toString("utf8"),
          });
        } catch (cause) {
          throw new Error(
            `invalid base64 input: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      return JSON.stringify({
        mode: "encode",
        result: Buffer.from(text, "utf8").toString("base64"),
      });
    },
  }),
  hash: defineTool({
    name: "hash",
    description:
      "Compute a cryptographic hash. Input { algorithm: md5|sha1|sha256|sha512 (default sha256), text }.",
    inputSchema: hashSchema,
    handler: ({ algorithm, text }) => {
      return JSON.stringify({
        algorithm,
        digest: createHash(algorithm).update(text).digest("hex"),
      });
    },
  }),
  timezone: defineTool({
    name: "timezone",
    description:
      'Current local time in any IANA timezone. Input { tz: "America/Sao_Paulo" }. Defaults to UTC.',
    inputSchema: timezoneSchema,
    handler: ({ tz }) => {
      try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        return JSON.stringify({ timeZone: tz, now: formatter.format(new Date()) });
      } catch (cause) {
        throw new Error(
          `invalid IANA timezone "${tz}": ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    },
  }),
};

export function listAdHocTools(): string {
  const names = Object.keys(AD_HOC_TOOLS).sort();
  return names.map((n) => `• \`${n}\` — ${AD_HOC_TOOLS[n]?.description ?? ""}`).join("\n");
}
