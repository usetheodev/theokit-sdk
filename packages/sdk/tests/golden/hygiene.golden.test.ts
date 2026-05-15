import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { hasContractSignal } from "../helpers/contract-signal.js";

const allowedEmptyGoldens = new Set(["artifacts/local-list-empty.json"]);
const allowedLiteralTokens = new Set(["context/snapshot.local.json"]);

describe("golden file hygiene", () => {
  it("keeps every golden JSON deterministic, reviewable, and parseable", async () => {
    const entries = await readGoldenFiles();

    expect(entries.length).toBeGreaterThanOrEqual(20);

    for (const { absolutePath, relativePath, raw } of entries) {
      const parsed = JSON.parse(raw) as unknown;
      const serialized = JSON.stringify(parsed);

      expect(raw.trim(), relativePath).not.toBe("");
      expect(serialized, relativePath).not.toMatch(
        /\b(?:agent|bc|run|request|call|cron)-[0-9a-fA-F-]{8,}\b/,
      );
      expect(serialized, relativePath).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(serialized, relativePath).not.toMatch(/\/tmp\/|\/var\/folders\/|[A-Z]:\\\\/);
      expect(serialized, relativePath).not.toMatch(
        /https:\/\/github\.com\/[^/\s"]+\/[^/\s"]+\/pull\/\d+/,
      );
      expect(serialized, relativePath).not.toMatch(/\b(?:sk|theo|tok)_[A-Za-z0-9_-]{8,}\b/);
      expect(serialized, relativePath).not.toMatch(
        /fixture-search-secret|super-secret|secret-value/,
      );
      if (!allowedLiteralTokens.has(relativePath)) {
        expect(hasUnsafeSecretKey(parsed), relativePath).toBe(false);
      }

      if (!allowedEmptyGoldens.has(relativePath)) {
        expect(hasContractSignal(parsed), relativePath).toBe(true);
      }

      await expect(readFile(absolutePath, "utf8")).resolves.toBe(raw);
    }
  });

  it("does not freeze deep tool call args or results", async () => {
    const toolCallGoldens = (await readGoldenFiles()).filter(({ raw }) =>
      raw.includes('"tool_call"'),
    );

    expect(toolCallGoldens.length).toBeGreaterThanOrEqual(1);
    for (const { relativePath, raw } of toolCallGoldens) {
      const parsed = JSON.parse(raw) as unknown;
      const toolCalls = collectToolCalls(parsed);

      expect(toolCalls.length, relativePath).toBeGreaterThanOrEqual(1);
      for (const toolCall of toolCalls) {
        expect(toolCall, relativePath).toMatchObject({
          type: "tool_call",
          call_id: expect.any(String),
          name: expect.any(String),
          status: expect.any(String),
          args: "<unknown>",
          result: "<unknown>",
        });
      }
    }
  });
});

async function readGoldenFiles(): Promise<
  Array<{ absolutePath: string; relativePath: string; raw: string }>
> {
  const root = new URL(".", import.meta.url).pathname;
  const absolutePaths = await listJsonFiles(root);
  const entries = await Promise.all(
    absolutePaths.map(async (absolutePath) => ({
      absolutePath,
      relativePath: relative(root, absolutePath),
      raw: await readFile(absolutePath, "utf8"),
    })),
  );
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) return listJsonFiles(absolutePath);
      if (entry.isFile() && extname(entry.name) === ".json") return [absolutePath];
      return [];
    }),
  );
  return nested.flat();
}

function collectToolCalls(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => collectToolCalls(item));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = record.type === "tool_call" ? [record] : [];
  return current.concat(Object.values(record).flatMap((child) => collectToolCalls(child)));
}

function hasUnsafeSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasUnsafeSecretKey(item));
  if (!value || typeof value !== "object") return false;

  for (const [key, child] of Object.entries(value)) {
    if (
      /^(?:apiKey|api_key|authorization|password|secret|token|accessToken|refreshToken|clientSecret|client_secret)$/i.test(
        key,
      )
    ) {
      return true;
    }
    if (hasUnsafeSecretKey(child)) return true;
  }
  return false;
}
