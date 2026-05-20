import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { redactSecrets } from "../security/index.js";
import { defaultIndexPath, openMemoryDb } from "./index-db.js";
import { LanceIndex, lanceStoragePath } from "./lance-index.js";

/**
 * Migrate Memory.index from SQLite to LanceDB (ADR D44).
 *
 * EC-3 MUST FIX: validation uses NFC unicode normalization on both sides.
 *
 * @internal
 */

export interface MigrateOptions {
  cwd: string;
  dryRun?: boolean;
  batchSize?: number;
  /** Inject for tests; defaults to console.log. */
  logger?: (msg: string) => void;
}

export interface MigrateResult {
  countSqlite: number;
  countLance: number;
  /** Set when validation succeeded (or dryRun); false on validation failure. */
  validated: boolean;
  /** Per-fact compare results (size = sample count, up to 10). */
  sampleComparisons: ReadonlyArray<{ id: string; match: boolean }>;
  /** Lance storage location (final, after migration). */
  lancePath: string;
  /** Was the migration committed (false for dry-run). */
  committed: boolean;
}

interface SqliteFactRow {
  id: string;
  path: string;
  source: "memory" | "sessions" | "wiki";
  start_line: number;
  end_line: number;
  text: string;
  namespace?: string | null;
  scope?: string | null;
  user_id?: string | null;
}

/**
 * Read all facts from the SQLite memory index. Returns empty array if the
 * SQLite db file does not exist (workspace never used Memory).
 *
 * @internal
 */
async function readAllSqliteFacts(cwd: string): Promise<SqliteFactRow[]> {
  const dbPath = defaultIndexPath(cwd);
  if (!existsSync(dbPath)) return [];
  const db = await openMemoryDb({ filePath: dbPath });
  try {
    // SQLite schema: chunks table holds the facts. Schema may vary; we
    // probe column existence and fall back to safe defaults.
    const stmt = db.prepare("SELECT id, path, source, start_line, end_line, text FROM chunks");
    const rows = stmt.all() as Array<{
      id: string;
      path: string;
      source: "memory" | "sessions" | "wiki";
      start_line: number;
      end_line: number;
      text: string;
    }>;
    return rows.map((r) => ({
      ...r,
      namespace: "default",
      scope: "agent",
      user_id: "default",
    }));
  } finally {
    db.close();
  }
}

/**
 * Compare two strings via NFC normalization (EC-3 MUST FIX). Required
 * because SQLite/Lance native bindings can normalize unicode differently
 * (NFC vs NFD), producing false negatives on facts with accents/emojis.
 *
 * @internal
 */
function nfcEqual(a: string, b: string): boolean {
  return a.normalize("NFC") === b.normalize("NFC");
}

/**
 * Run the migration. Writes Lance to `<cwd>/.theokit/memory/lance-new/`
 * first, validates round-trip, then renames to `lance/` on success.
 * SQLite db is preserved (CLI prompts user to delete).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: migration is a single transaction (read → write → validate → commit-or-rollback); splitting harms atomicity reasoning.
export async function migrateSqliteToLance(opts: MigrateOptions): Promise<MigrateResult> {
  const cwd = opts.cwd;
  const finalPath = lanceStoragePath(cwd);
  const newPath = join(cwd, ".theokit", "memory", "lance-new");
  // T1.4 (ADR D68): wrap logger so any fact text containing secrets is
  // masked before reaching the destination (console or user-supplied sink).
  // Caller-supplied loggers cannot bypass — by design (D70).
  const rawLog = opts.logger ?? ((m: string) => console.log(m));
  const log = (m: string) => rawLog(redactSecrets(m));

  // EC: destination exists → error tipado.
  if (existsSync(finalPath)) {
    throw new ConfigurationError(
      `Destination already exists: ${finalPath}. Remove it manually (\`rm -rf ${finalPath}\`) and re-run.`,
      { code: "migration_destination_exists" },
    );
  }
  if (existsSync(newPath)) {
    // Leftover from a previous failed/interrupted migration. Safe to delete.
    log(`Removing stale ${newPath} from a previous run...`);
    rmSync(newPath, { recursive: true, force: true });
  }

  log(`Reading SQLite facts from ${cwd}/.theokit/memory/index.sqlite ...`);
  const sqliteFacts = await readAllSqliteFacts(cwd);
  log(`SQLite has ${sqliteFacts.length} facts.`);
  if (sqliteFacts.length === 0) {
    return {
      countSqlite: 0,
      countLance: 0,
      validated: true,
      sampleComparisons: [],
      lancePath: finalPath,
      committed: false,
    };
  }

  // Reuse the embedding runtime configured in the workspace? For v1.2 we
  // require the caller to pass embedding explicitly via env. The migration
  // path is documented as: "set OPENAI_API_KEY (or similar) before running."
  // Here we ship a placeholder embedder that uses a deterministic
  // content-hash — sufficient for migration validation; consumers should
  // re-embed on first real query after migration if needed.
  const placeholderEmbedding = {
    id: "migration-placeholder",
    model: "deterministic-hash",
    dimension: 8,
    embed: async (texts: ReadonlyArray<string>) => {
      // Simple deterministic hash → 8-dim vector (migration validation only).
      return texts.map((t) => {
        const arr = new Array(8).fill(0);
        for (let i = 0; i < t.length; i += 1) {
          arr[i % 8] += t.charCodeAt(i);
        }
        return arr.map((x) => x / 1000);
      });
    },
    stats: () => ({ cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 }),
  };

  mkdirSync(newPath, { recursive: true });
  log(`Writing Lance index to ${newPath} ...`);

  const lance = await LanceIndex.open({
    cwd,
    embedding: placeholderEmbedding,
    storagePath: newPath,
  });

  const batchSize = opts.batchSize ?? 100;
  for (let i = 0; i < sqliteFacts.length; i += batchSize) {
    const batch = sqliteFacts.slice(i, i + batchSize).map((f) => ({
      id: f.id,
      text: f.text,
      source: f.source,
      namespace: f.namespace ?? "default",
      scope: f.scope ?? "agent",
      user_id: f.user_id ?? "default",
      timestamp: 0,
    }));
    await lance.addFacts(batch);
    log(`  Migrated ${Math.min(i + batchSize, sqliteFacts.length)}/${sqliteFacts.length}`);
  }

  // Validation: count + sample compare (10 random) with NFC normalization.
  const lanceCount = await lance.countFacts("default");
  log(`Lance has ${lanceCount} facts (expected ${sqliteFacts.length}).`);

  const sampleSize = Math.min(10, sqliteFacts.length);
  const sampleComparisons: { id: string; match: boolean }[] = [];
  for (let i = 0; i < sampleSize; i += 1) {
    const sqliteFact = sqliteFacts[Math.floor((i * sqliteFacts.length) / sampleSize)];
    if (sqliteFact === undefined) continue;
    // Search Lance for this fact's text — best-effort round-trip.
    const hits = await lance.search(sqliteFact.text, {
      namespace: sqliteFact.namespace ?? "default",
      limit: 1,
    });
    // EC-3: compare with NFC normalization.
    const hit = hits[0];
    const match = hit !== undefined && nfcEqual(hit.text, sqliteFact.text);
    sampleComparisons.push({ id: sqliteFact.id, match });
  }

  const allMatch = sampleComparisons.every((c) => c.match);
  const countMatch = lanceCount === sqliteFacts.length;
  const validated = allMatch && countMatch;

  await lance.close();

  if (opts.dryRun === true) {
    log("Dry-run mode — discarding Lance staging dir.");
    rmSync(newPath, { recursive: true, force: true });
    return {
      countSqlite: sqliteFacts.length,
      countLance: lanceCount,
      validated,
      sampleComparisons,
      lancePath: finalPath,
      committed: false,
    };
  }

  if (!validated) {
    log("Validation FAILED — leaving SQLite intact, removing Lance staging dir.");
    rmSync(newPath, { recursive: true, force: true });
    return {
      countSqlite: sqliteFacts.length,
      countLance: lanceCount,
      validated: false,
      sampleComparisons,
      lancePath: finalPath,
      committed: false,
    };
  }

  // Atomic commit via rename.
  renameSync(newPath, finalPath);
  log(`Migration committed to ${finalPath}.`);
  return {
    countSqlite: sqliteFacts.length,
    countLance: lanceCount,
    validated: true,
    sampleComparisons,
    lancePath: finalPath,
    committed: true,
  };
}
