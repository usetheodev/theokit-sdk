/**
 * `theokit db` subcommand — thin wrapper over drizzle-kit (ADR D6 / orm-v1 D6:
 * delegate migrations to canonical drizzle-kit; do not reinvent).
 *
 * Subcommands:
 *   - `theokit db generate`       → drizzle-kit generate
 *   - `theokit db migrate`        → drizzle-kit migrate
 *   - `theokit db studio`         → drizzle-kit studio
 *   - `theokit db push`           → drizzle-kit push (dangerous, gated)
 *   - `theokit db export-schema`  → run @usetheo/orm schema-export → .theokit/schema/{entity}.schema.json
 *   - `theokit db check-schema-drift`
 *                                 → re-emit and diff against committed schemas; exit 1 on drift
 *
 * Implementation principles:
 *   - drizzle-kit lookups via the host workspace's node_modules (no bundled binary)
 *   - export-schema and check-schema-drift load `orm.config.ts` from cwd
 *     (must default-export `{ schema, dialect, db? }` shape — only `schema` is used)
 *   - All file writes are atomic (write tmp + rename)
 *   - All paths sanitized via path.resolve before write
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

export interface DbCommandOptions {
  readonly cwd?: string;
}

export interface DbExportSchemaOptions extends DbCommandOptions {
  readonly out?: string;
  readonly config?: string;
}

export interface DbCheckDriftOptions extends DbExportSchemaOptions {}

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

export function runDbGenerate(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("generate", opts.cwd ?? process.cwd());
}
export function runDbMigrate(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("migrate", opts.cwd ?? process.cwd());
}
export function runDbStudio(opts: DbCommandOptions = {}): number {
  return runDrizzleKit("studio", opts.cwd ?? process.cwd());
}
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
    join(cwd, "node_modules", "@usetheo", "orm", "dist", "schema-export.js"),
    join(cwd, "node_modules", "@usetheo", "orm", "schema-export.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return (await import(pathToFileURL(c).href)) as SchemaExportModule;
    }
  }
  throw new Error("theokit db: @usetheo/orm is not installed. Install it: pnpm add @usetheo/orm");
}

function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o644 });
  renameSync(tmp, filePath);
}

export async function runDbExportSchema(opts: DbExportSchemaOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.config ?? "orm.config.ts");
  const outDir = resolve(cwd, opts.out ?? ".theokit/schema");

  let config: OrmConfig;
  try {
    config = await loadOrmConfig(configPath);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let exporter: SchemaExportModule;
  try {
    exporter = await loadSchemaExporter(cwd);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let schemas: Record<string, unknown>;
  try {
    schemas = exporter.exportSchemas(config.schema);
  } catch (err) {
    process.stderr.write(
      `theokit db: schema export failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  // Clean existing .schema.json files (so renamed/dropped entities don't linger)
  for (const f of readdirSync(outDir).filter((n) => n.endsWith(".schema.json"))) {
    unlinkSync(join(outDir, f));
  }

  for (const [name, schema] of Object.entries(schemas)) {
    const target = join(outDir, `${name}.schema.json`);
    atomicWrite(target, `${JSON.stringify(schema, null, 2)}\n`);
  }
  process.stdout.write(`theokit db: wrote ${Object.keys(schemas).length} schema(s) to ${outDir}\n`);
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

export async function runDbCheckSchemaDrift(opts: DbCheckDriftOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = resolve(cwd, opts.config ?? "orm.config.ts");
  const outDir = resolve(cwd, opts.out ?? ".theokit/schema");

  let config: OrmConfig;
  try {
    config = await loadOrmConfig(configPath);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let exporter: SchemaExportModule;
  try {
    exporter = await loadSchemaExporter(cwd);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const fresh = exporter.exportSchemas(config.schema);
  const committed = readCommittedSchemas(outDir);

  const freshKeys = new Set(Object.keys(fresh));
  const committedKeys = new Set(Object.keys(committed));

  const added: string[] = [...freshKeys].filter((k) => !committedKeys.has(k));
  const removed: string[] = [...committedKeys].filter((k) => !freshKeys.has(k));
  const changed: string[] = [];
  for (const k of freshKeys) {
    if (committedKeys.has(k)) {
      if (JSON.stringify(fresh[k]) !== JSON.stringify(committed[k])) {
        changed.push(k);
      }
    }
  }

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
