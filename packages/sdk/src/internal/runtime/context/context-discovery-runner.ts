/**
 * Multi-format context discovery runner (T5.1, ADRs D150-D156).
 *
 * Walks `DEFAULT_DISCOVERY_SPECS` (or caller override), loads each
 * spec via the appropriate parser, applies `@import` resolution where
 * declared, and returns a flat list of `AggregatorSource[]` ready for
 * the aggregate cap.
 *
 * **EC-E privacy fix:** source disambiguation uses
 * `relative(gitRoot ?? cwd, ...)` — NEVER absolute paths in
 * `<source name="">`.
 *
 * @internal
 */

import { readFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

import type { AggregatorSource } from "./context-aggregator.js";
import {
  DEFAULT_DISCOVERY_SPECS,
  type DiscoverySpec,
  findGitRoot,
  walkUpForFile,
  walkUpForGlob,
} from "./context-discovery.js";
import { resolveImports } from "./context-import-resolver.js";
import { loadPlainMarkdown } from "./context-loaders.js";
import { parseMdc, shouldActivate } from "./context-mdc-parser.js";
import { parseRules, shouldActivateRule } from "./context-rules-frontmatter.js";

export interface DiscoveryRunnerOptions {
  /** Workspace root passed to all discovery scopes. */
  readonly cwd: string;
  /** Per-file truncation cap (D155). */
  readonly maxBytesPerFile: number;
  /** Optional override of the default registry. */
  readonly specs?: ReadonlyArray<DiscoverySpec>;
  /** Cursor MDC: file paths the LLM has touched this turn (EC-I: empty at send-time). */
  readonly touchedFiles?: ReadonlyArray<string>;
  /** When true, skip `theokit-context` spec — caller already handles the legacy path. */
  readonly skipLegacyTheokitContext?: boolean;
}

/**
 * Run discovery + loading across all specs. Returns sources ready for
 * the aggregator (priority + content fields populated).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-spec dispatch ladder + cross-spec dedup is a flat orchestrator; splitting would obscure the priority-merge invariant.
export async function runDiscovery(opts: DiscoveryRunnerOptions): Promise<AggregatorSource[]> {
  const gitRoot = findGitRoot(opts.cwd);
  const specs = opts.specs ?? DEFAULT_DISCOVERY_SPECS;
  const out: AggregatorSource[] = [];
  const seenReal = new Set<string>();

  for (const spec of specs) {
    if (opts.skipLegacyTheokitContext && spec.id === "theokit-context") continue;
    const paths = await resolvePathsForSpec(spec, opts.cwd, gitRoot);
    for (const path of paths) {
      if (seenReal.has(path)) continue;
      seenReal.add(path);
      const source = await loadOneSource(spec, path, opts, gitRoot);
      if (source !== undefined) out.push(source);
    }
  }
  return out;
}

async function resolvePathsForSpec(
  spec: DiscoverySpec,
  cwd: string,
  gitRoot: string | undefined,
): Promise<string[]> {
  if (spec.scope === "cwd-only") {
    return walkUpForFile(cwd, spec.pattern, cwd);
  }
  if (spec.scope === "git-root-walk") {
    return walkUpForFile(cwd, spec.pattern, gitRoot ?? cwd);
  }
  // globbed
  return walkUpForGlob(cwd, spec.pattern);
}

async function loadOneSource(
  spec: DiscoverySpec,
  path: string,
  opts: DiscoveryRunnerOptions,
  gitRoot: string | undefined,
): Promise<AggregatorSource | undefined> {
  // EC-E privacy: name uses relative-to-git-root for disambiguation;
  // NEVER absolute paths in the public `<source name="">` attribute.
  // For cwd-only specs (THEO.md), no disambiguation is needed because
  // the scope can only ever match a single file.
  const relPath = relative(gitRoot ?? opts.cwd, dirname(path));
  const needsSuffix = spec.scope !== "cwd-only" && relPath !== "" && relPath !== ".";
  const id = needsSuffix ? `${spec.id}@${relPath}` : spec.id;

  if (spec.parser === "mdc") {
    return loadMdcSource(spec, path, id, opts);
  }
  if (spec.parser === "rules-frontmatter") {
    return loadRulesSource(spec, path, id, opts);
  }
  if (spec.parser === "frontmatter-zod") {
    // Legacy `.theokit/context/*.md` — handled by `loadContextConfig` in
    // `context-manager.ts` for backward compat. We skip here unless caller
    // explicitly wants us to load it (currently always skipped).
    return undefined;
  }
  // plain-markdown
  return loadPlainMarkdownSource(spec, path, id, opts);
}

/**
 * Shared read → parse → activation-gate → source pipeline for the frontmatter
 * discovery parsers (mdc, rules). Binds the parser + the activation predicate so
 * the mdc and rules loaders differ only in those two, not in the surrounding
 * read/guard/shape boilerplate (DRY).
 */
async function loadParsedSource<F>(
  spec: DiscoverySpec,
  path: string,
  id: string,
  parse: (raw: string) => { frontmatter: F; body: string } | undefined,
  isActive: (frontmatter: F) => boolean,
): Promise<AggregatorSource | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const parsed = parse(raw);
  if (parsed === undefined || !isActive(parsed.frontmatter)) return undefined;
  return { id, source: path, content: parsed.body, priority: spec.priority, truncated: false };
}

function loadMdcSource(
  spec: DiscoverySpec,
  path: string,
  id: string,
  opts: DiscoveryRunnerOptions,
): Promise<AggregatorSource | undefined> {
  return loadParsedSource(spec, path, id, parseMdc, (fm) =>
    shouldActivate(fm, opts.touchedFiles ?? []),
  );
}

function loadRulesSource(
  spec: DiscoverySpec,
  path: string,
  id: string,
  opts: DiscoveryRunnerOptions,
): Promise<AggregatorSource | undefined> {
  return loadParsedSource(spec, path, id, parseRules, (fm) =>
    shouldActivateRule(fm, opts.touchedFiles ?? []),
  );
}

async function loadPlainMarkdownSource(
  spec: DiscoverySpec,
  path: string,
  id: string,
  opts: DiscoveryRunnerOptions,
): Promise<AggregatorSource | undefined> {
  const loaded = await loadPlainMarkdown(path, { maxBytesPerFile: opts.maxBytesPerFile });
  if (loaded === undefined) return undefined;
  let content = loaded.content;
  if (spec.followImports) {
    content = await resolveImports(content, path, {
      visited: new Set([path]),
      depth: 0,
      maxBytesPerFile: opts.maxBytesPerFile,
    });
  }
  return {
    id,
    source: path,
    content,
    priority: spec.priority,
    truncated: loaded.truncated,
  };
}
