import Database from "better-sqlite3";
import { initDb } from "./schema.js";

/**
 * Opens (or creates) a SQLite database at the given path,
 * applies the session schema, and returns the db instance.
 * Pass ":memory:" for an ephemeral in-memory database.
 */
export function openSessionDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  initDb(db);
  return db;
}
