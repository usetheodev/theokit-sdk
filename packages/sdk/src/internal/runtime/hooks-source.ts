/**
 * Single source of truth for loading the hooks config (T1.2, ADR D77).
 *
 * Detection order:
 *   1. `.theokit/hooks/*.md` (markdown, frontmatter-validated) — canonical.
 *   2. `.theokit/hooks.json` — legacy. Emits one-time deprecation warn.
 *   3. Neither → empty config (no hooks).
 *
 * Consumed by `hooks-loader.ts` (boot-time validation) and
 * `hooks-executor.ts` (runtime dispatch).
 *
 * @internal
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { z } from "zod";

import { ConfigurationError } from "../../errors.js";
import { loadMarkdownEntities } from "../persistence/markdown-config-loader.js";
import { HookFrontmatterSchema } from "./hooks-frontmatter.js";

export type HookEvent = "preRun" | "postRun" | "preToolUse" | "postToolUse" | "stop";

export interface HookCommand {
  command: string;
  matcher?: string;
  timeoutMs?: number;
}

export interface HookConfig {
  hooks?: Partial<Record<HookEvent, HookCommand[]>>;
}

const warned = new Set<string>();

/**
 * Emit a stderr warn once per process per unique key. Helps surface the
 * deprecation path without spamming when the loader is called many times
 * during a session (cron + send + skills all hit this).
 *
 * Note: spawned workers (cron, subagent) start fresh processes — warn
 * re-emits there, by design (1 per process boot, not per call).
 *
 * @internal
 */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  process.stderr.write(`${message}\n`);
}

/** Reset for tests; not exported via barrel. @internal */
export function _resetWarnOnceForTests(): void {
  warned.clear();
}

/**
 * Load hooks from `.theokit/hooks/*.md` (preferred) or `.theokit/hooks.json`
 * (legacy fallback).
 *
 * @internal
 */
export async function loadHookConfig(cwd: string): Promise<HookConfig> {
  const mdDir = join(cwd, ".theokit", "hooks");
  const jsonPath = join(cwd, ".theokit", "hooks.json");

  const mdEntities = await loadMarkdownEntities({
    dir: mdDir,
    schema: HookFrontmatterSchema,
    pattern: "flat",
    errorCodePrefix: "hook",
  });

  if (mdEntities.length > 0) {
    if (existsSync(jsonPath)) {
      warnOnce(
        "hooks-both-present",
        "[theokit-sdk] both .theokit/hooks/ and .theokit/hooks.json detected — using markdown; remove hooks.json",
      );
    }
    return buildConfigFromMarkdown(mdEntities);
  }

  // Fallback: JSON
  if (!existsSync(jsonPath)) return {};

  warnOnce(
    "hooks-json-deprecated",
    "[theokit-sdk] .theokit/hooks.json is deprecated; migrate to .theokit/hooks/<name>.md via theokit-migrate-config",
  );

  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch (cause) {
    throw new ConfigurationError(`Failed to read hooks config: ${jsonPath}`, {
      code: "hooks_read_error",
      cause,
    });
  }
  try {
    return JSON.parse(raw) as HookConfig;
  } catch (cause) {
    throw new ConfigurationError(`Invalid JSON in hooks config: ${jsonPath}`, {
      code: "hooks_json_invalid",
      cause,
    });
  }
}

type HookEntities = Awaited<
  ReturnType<typeof loadMarkdownEntities<z.infer<typeof HookFrontmatterSchema>>>
>;

function buildConfigFromMarkdown(entities: HookEntities): HookConfig {
  const grouped: Partial<Record<HookEvent, HookCommand[]>> = {};
  // Sort by priority asc so lower priority runs first when grouped.
  const sorted = [...entities].sort(
    (a, b) => (a.frontmatter.priority ?? 0) - (b.frontmatter.priority ?? 0),
  );
  for (const entity of sorted) {
    if (entity.frontmatter.enabled === false) continue;
    const event = entity.frontmatter.event as HookEvent;
    const list = grouped[event] ?? [];
    const command: HookCommand = {
      command: entity.frontmatter.command,
      matcher: entity.frontmatter.matcher,
    };
    if (entity.frontmatter.timeoutMs !== undefined) {
      command.timeoutMs = entity.frontmatter.timeoutMs;
    }
    list.push(command);
    grouped[event] = list;
  }
  return { hooks: grouped };
}
