/**
 * `theokit db` subcommand — thin wrapper over drizzle-kit (ADR D6 / orm-v1 D6:
 * delegate migrations to canonical drizzle-kit; do not reinvent).
 *
 * Subcommands:
 *   - `theokit db generate`       → drizzle-kit generate
 *   - `theokit db migrate`        → drizzle-kit migrate
 *   - `theokit db studio`         → drizzle-kit studio
 *   - `theokit db push`           → drizzle-kit push (dangerous, and NOT gated by this CLI —
 *                                   drizzle-kit's own confirmation is the only prompt)
 *   - `theokit db export-schema`  → run @theokit/orm schema-export → .theokit/schema/{entity}.schema.json
 *   - `theokit db check-schema-drift`
 *                                 → re-emit and diff against committed schemas; exit 1 on drift
 *
 * Implementation principles:
 *   - drizzle-kit lookups via the host workspace's node_modules (no bundled binary)
 *   - export-schema and check-schema-drift load `orm.config.ts` from cwd
 *     (must default-export `{ schema, dialect, db? }` shape — only `schema` is used)
 *   - All file writes are atomic (write tmp + rename)
 *   - All paths resolved with `path.resolve` before write. That normalises, it does not CONFINE:
 *     `--out ../../elsewhere` resolves cleanly and writes there. These flags are operator input,
 *     not untrusted input.
 *
 * Exit codes: `0` success; `1` the schema exporter threw, or (for `check-schema-drift`) drift was
 * found; `2` a precondition the operator can fix — drizzle-kit absent, `orm.config` missing or
 * without a `{ schema }` default export, `@theokit/orm` not installed. The four drizzle-kit
 * wrappers instead forward the child process's own exit code, and return `1` when it is killed by a
 * signal.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Shared options. `cwd` defaults to `process.cwd()` and is the root for every lookup below it. */
interface DbCommandOptions {
  readonly cwd?: string;
}

/** Options for the two schema commands. Both paths are resolved against `cwd`; neither is confined to it. */
interface DbExportSchemaOptions extends DbCommandOptions {
  /** Output directory. Default `.theokit/schema`. */
  readonly out?: string;
  /** Path to the ORM config module. Default `orm.config.ts`. */
  readonly config?: string;
}

type DbCheckDriftOptions = DbExportSchemaOptions;

interface OrmConfig {
  schema: Record<string, unknown>;
}

function findDrizzleKit(cwd: string): string | null {
  const candidates = [
    join(cwd, "node_modules", ".bin", "drizzle-kit"),
    join(cwd, "node_modules", "drizzle-kit", "bin.cjs"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function runDrizzleKit(verb: string, cwd: string, extraArgs: string[] = []): number {
  const bin = findDrizzleKit(cwd);
  if (!bin) {
    process.stderr.write(
      "theokit db: drizzle-kit not found in node_modules. Install it: pnpm add -D drizzle-kit\n",
    );
    return 2;
  }
  const r = spawnSync(bin, [verb, ...extraArgs], { cwd, stdio: "inherit" });
  if (r.status === null) return 1;
  return r.status;
}

/** `drizzle-kit generate` in `cwd`, stdio inherited. Returns its exit code (2 if drizzle-kit is absent). */
export function runDbGenerate(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("generate", opts.cwd ?? process.cwd());
}
/** `drizzle-kit migrate` in `cwd`, stdio inherited. Returns its exit code (2 if drizzle-kit is absent). */
export function runDbMigrate(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("migrate", opts.cwd ?? process.cwd());
}
/**
 * `drizzle-kit studio` in `cwd`, stdio inherited. BLOCKS until the studio server is stopped —
 * `spawnSync` gives the child the terminal.
 */
export function runDbStudio(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("studio", opts.cwd ?? process.cwd());
}
/**
 * `drizzle-kit push` in `cwd` — applies the schema straight to the live database, with no migration
 * file. This CLI adds NO confirmation of its own; whatever drizzle-kit prompts is all the protection
 * there is. Prototypes only.
 */
export function runDbPush(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("push", opts.cwd ?? process.cwd());
}

async function loadOrmConfig(configPath: string): Promise<OrmConfig> {
  if (!existsSync(configPath)) {
    throw new Error(
      `theokit db: orm.config not found at ${configPath}. Create one that default-exports { schema } (the Drizzle schema object).`,
    );
  }
  // Cache-bust so consecutive invocations (drift workflows, tests) see edits.
  const bust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const url = `${pathToFileURL(configPath).href}?v=${bust}`;
  const mod = (await import(url)) as { default?: OrmConfig };
  if (!mod.default || typeof mod.default !== "object" || !mod.default.schema) {
    throw new Error(
      `theokit db: orm.config at ${configPath} must default-export { schema }. Got: ${typeof mod.default}`,
    );
  }
  return mod.default;
}

interface SchemaExportModule {
  exportSchemas: (schema: Record<string, unknown>) => Record<string, unknown>;
}

async function loadSchemaExporter(cwd: string): Promise<SchemaExportModule> {
  const candidates = [
    join(cwd, "node_modules", "@theokit", "orm", "dist", "schema-export.js"),
    join(cwd, "node_modules", "@theokit", "orm", "schema-export.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return (await import(pathToFileURL(c).href)) as SchemaExportModule;
    }
  }
  throw new Error("theokit db: @theokit/orm is not installed. Install it: pnpm add @theokit/orm");
}

function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o644 });
  renameSync(tmp, filePath);
}

async function loadConfigOrError(
  configPath: string,
): Promise<{ ok: true; value: OrmConfig } | { ok: false; code: number }> {
  try {
    return { ok: true, value: await loadOrmConfig(configPath) };
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return { ok: false, code: 2 };
  }
}

async function loadExporterOrError(
  cwd: string,
): Promise<{ ok: true; value: SchemaExportModule } | { ok: false; code: number }> {
  try {
    return { ok: true, value: await loadSchemaExporter(cwd) };
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return { ok: false, code: 2 };
  }
}

function exportSchemasOrError(
  exporter: SchemaExportModule,
  schema: OrmConfig["schema"],
): { ok: true; value: Record<string, unknown> } | { ok: false; code: number } {
  try {
    return { ok: true, value: exporter.exportSchemas(schema) };
  } catch (err) {
    process.stderr.write(
      `theokit db: schema export failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return { ok: false, code: 1 };
  }
}

function writeSchemasToOutDir(schemas: Record<string, unknown>, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  // Clean existing .schema.json files (so renamed/dropped entities don't linger)
  for (const f of readdirSync(outDir).filter((n) => n.endsWith(".schema.json"))) {
    unlinkSync(join(outDir, f));
  }
  for (const [name, schema] of Object.entries(schemas)) {
    const target = join(outDir, `${name}.schema.json`);
    atomicWrite(target, `${JSON.stringify(schema, null, 2)}\n`);
  }
}

/**
 * Emit one JSON Schema 7 file per entity, for consumers outside TypeScript.
 *
 * Loads `orm.config.ts` (override with `config`) and `@theokit/orm` from the project's own
 * `node_modules`, then writes `<out>/<entity>.schema.json` (default `.theokit/schema`). Each write is
 * atomic, but the directory is not: EVERY existing `*.schema.json` in `out` is deleted first, so
 * pointing `--out` at a directory holding unrelated schema files loses them.
 *
 * The config module is imported with a cache-busting query, so consecutive calls in one process see
 * edits — and re-run its top-level side effects.
 *
 * @returns 0 on success, 2 for a missing/invalid config or a missing `@theokit/orm`, 1 when the
 * exporter itself throws.
 */
export async function runDbExportSchema(opts: DbExportSchemaOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.config ?? "orm.config.ts");
  const outDir = resolve(cwd, opts.out ?? ".theokit/schema");

  const configResult = await loadConfigOrError(configPath);
  if (!configResult.ok) return configResult.code;

  const exporterResult = await loadExporterOrError(cwd);
  if (!exporterResult.ok) return exporterResult.code;

  const schemasResult = exportSchemasOrError(exporterResult.value, configResult.value.schema);
  if (!schemasResult.ok) return schemasResult.code;

  writeSchemasToOutDir(schemasResult.value, outDir);
  process.stdout.write(
    `theokit db: wrote ${Object.keys(schemasResult.value).length} schema(s) to ${outDir}\n`,
  );
  return 0;
}

function readCommittedSchemas(outDir: string): Record<string, unknown> {
  if (!existsSync(outDir)) return {};
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(outDir).filter((n) => n.endsWith(".schema.json"))) {
    const name = f.replace(/\.schema\.json$/, "");
    out[name] = JSON.parse(readFileSync(join(outDir, f), "utf-8"));
  }
  return out;
}

interface SchemaDrift {
  added: string[];
  removed: string[];
  changed: string[];
}

function computeSchemaDrift(
  fresh: Record<string, unknown>,
  committed: Record<string, unknown>,
): SchemaDrift {
  const freshKeys = new Set(Object.keys(fresh));
  const committedKeys = new Set(Object.keys(committed));
  const added = [...freshKeys].filter((k) => !committedKeys.has(k));
  const removed = [...committedKeys].filter((k) => !freshKeys.has(k));
  const changed = [...freshKeys].filter(
    (k) => committedKeys.has(k) && JSON.stringify(fresh[k]) !== JSON.stringify(committed[k]),
  );
  return { added, removed, changed };
}

function reportSchemaDrift(drift: SchemaDrift): number {
  const { added, removed, changed } = drift;
  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    process.stdout.write("theokit db: schema in sync (no drift)\n");
    return 0;
  }
  process.stderr.write("theokit db: schema drift detected\n");
  if (added.length > 0) process.stderr.write(`  added:   ${added.join(", ")}\n`);
  if (removed.length > 0) process.stderr.write(`  removed: ${removed.join(", ")}\n`);
  if (changed.length > 0) process.stderr.write(`  changed: ${changed.join(", ")}\n`);
  process.stderr.write("Run `theokit db export-schema` to refresh.\n");
  return 1;
}

/**
 * Re-derive the schemas and compare them to the committed copies in `out`. Writes nothing.
 *
 * Drift is reported per entity as added / removed / changed, where "changed" is a strict
 * `JSON.stringify` inequality — key ORDER counts, so a hand-edited file that only reorders keys
 * reads as drift.
 *
 * @returns 0 when in sync, 1 when any drift is found (the CI signal), 2 for a missing/invalid config
 * or a missing `@theokit/orm`. Unlike `export-schema`, an exporter throw here is NOT caught and
 * propagates to the caller.
 */
export async function runDbCheckSchemaDrift(opts: DbCheckDriftOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.config ?? "orm.config.ts");
  const outDir = resolve(cwd, opts.out ?? ".theokit/schema");

  const configResult = await loadConfigOrError(configPath);
  if (!configResult.ok) return configResult.code;

  const exporterResult = await loadExporterOrError(cwd);
  if (!exporterResult.ok) return exporterResult.code;

  const fresh = exporterResult.value.exportSchemas(configResult.value.schema);
  const committed = readCommittedSchemas(outDir);
  return reportSchemaDrift(computeSchemaDrift(fresh, committed));
}
