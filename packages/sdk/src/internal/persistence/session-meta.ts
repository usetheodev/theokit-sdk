/**
 * SE4 — shared merge logic for {@link SessionMeta} + {@link SessionMetaPatch},
 * used identically by every {@link ConversationStorageAdapter} that persists
 * session metadata (FS sidecar + in-memory). Single source of truth for the
 * patch semantics: an omitted field is unchanged; a `null` field CLEARS it; a
 * string SETS it.
 *
 * @internal
 */

import type { SessionMeta, SessionMetaPatch } from "../../types/conversation-storage.js";

/** Apply a patch to session metadata, returning a fresh object. */
export function applyMetaPatch(current: SessionMeta, patch: SessionMetaPatch): SessionMeta {
  const next: { title?: string; tag?: string } = {};
  if (current.title !== undefined) next.title = current.title;
  if (current.tag !== undefined) next.tag = current.tag;
  // For each field: `null` clears, a string sets, omission leaves it unchanged.
  if (patch.title === null) delete next.title;
  else if (patch.title !== undefined) next.title = patch.title;
  if (patch.tag === null) delete next.tag;
  else if (patch.tag !== undefined) next.tag = patch.tag;
  return next;
}

/** Read a raw parsed sidecar object into a validated {@link SessionMeta} (string fields only). */
export function coerceSessionMeta(raw: unknown): SessionMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as { title?: unknown; tag?: unknown };
  const meta: { title?: string; tag?: string } = {};
  if (typeof obj.title === "string") meta.title = obj.title;
  if (typeof obj.tag === "string") meta.tag = obj.tag;
  return meta.title === undefined && meta.tag === undefined ? undefined : meta;
}
