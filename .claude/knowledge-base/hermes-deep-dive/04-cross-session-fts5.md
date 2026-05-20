# 04 — Cross-Session FTS5 Search (with LLM summarization)

> Hermes indexes every assistant + user + tool message ever exchanged in a
> single `state.db` SQLite database, with two parallel FTS5 virtual tables:
> a default-tokenizer table for Latin scripts and a *trigram* tokenizer
> table for CJK / Thai. A 6-step sanitizer converts user input into safe
> FTS5 MATCH syntax (quoting dotted/hyphenated identifiers, stripping bare
> boolean operators, preserving phrase searches). The `session_search`
> tool layers an LLM summarization pass on top: top-3 matching sessions
> are loaded, truncated to ~100k chars centered on hits, and summarized
> by the configured `auxiliary.session_search` model. In TypeScript:
> `Memory.searchAllSessions(query, options?)` returns either raw hits or
> summarized results, behind `better-sqlite3` + FTS5.

## What problem this domain solves

A user opens Hermes today and asks "how did we set up the auth tokens last week?" Without cross-session memory, the agent has no idea. The conversation that solved this is gone — JSON-blob session files don't get searched, vector stores fall over on exact-phrase recall ("the token in `.env.example`"), and naïve grep across N session files is O(N × sessionSize) and returns raw text without context.

The right shape is **a single SQLite DB with all messages indexed by FTS5**. SQLite's FTS5 module is fast (sub-second on millions of messages), supports phrase matching, prefix queries, boolean operators, ranked snippets — and is a standard library bundled into every recent Python and Node distribution. The cost is one DB to maintain across schema bumps and one query sanitizer to keep the user from accidentally breaking SQL.

The harder problem is *making the search results readable*. Raw FTS5 hits are noise — fragments out of context. The `session_search` tool fixes this by piping the top sessions to an LLM with a focused summarization prompt: "the user asked X, the previous you did Y, here's the procedure that worked." The agent gets a 3-paragraph answer instead of 30 fragments.

CJK is the third problem. SQLite's default `unicode61` tokenizer splits Chinese characters into individual tokens. The phrase 大别山项目 becomes `大 AND 别 AND 山 AND 项 AND 目` — useless for substring matching. The fix is a parallel `trigram` FTS5 table that creates overlapping 3-byte sequences; CJK queries with 3+ characters route there. Shorter CJK queries fall back to LIKE.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `hermes_state.py` | 2966 | `SessionDB` class. Schema, FTS5 tables, triggers, WAL fallback, atomic writes, search methods, sanitization. **The brain.** |
| `tools/session_search_tool.py` | 612 | Agent-facing tool: FTS5 search + LLM summarization + transcript truncation. |
| `tests/test_hermes_state.py` | — | SessionDB unit tests. |
| `tests/tools/test_session_search.py` | — | Search-tool unit tests. |
| `tests/acp/test_session.py` | — | ACP session persistence tests. |

Plus the memory-provider plugins under `plugins/memory/holographic/` (612 LoC across `store.py` and `retrieval.py`) which include FTS5-adjacent retrieval. These are *not* the primary FTS5 path; they are an alternative memory backend.

Confirmed via `wc -l hermes_state.py tools/session_search_tool.py` (3578 LoC total for the two primary files).

## Canonical entry point

Two functions. The first is the storage primitive; the second is the agent-facing tool.

```python
# hermes_state.py:1880
def search_messages(
    self,
    query: str,
    source_filter: List[str] = None,
    exclude_sources: List[str] = None,
    role_filter: List[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Full-text search across session messages using FTS5."""
```

```python
# tools/session_search_tool.py:325
def session_search(
    query: str,
    max_sessions: int = 3,
    source_filter: Optional[List[str]] = None,
    exclude_sources: Optional[List[str]] = None,
    ...
) -> str:
    """Uses FTS5 to find matches, then summarizes the top sessions with the
    auxiliary session_search model. Returns focused summaries of past
    conversations rather than raw transcripts, keeping the main model's
    context window clean."""
```

## Happy path: user asks about a topic from a prior conversation

```
USER: "how did we set up the auth tokens last week?"
  └─ Agent calls session_search(query="auth tokens setup")

[session_search_tool.py:325 — the entry]
  └─ session_db = SessionDB()  # opens ~/.hermes/state.db
       └─ apply_wal_with_fallback(conn, db_label="state.db")
            └─ Tries PRAGMA journal_mode=WAL; if "locking protocol" → DELETE fallback
       └─ Runs schema migrations if needed (SCHEMA_VERSION = 11)
       └─ Creates messages_fts + messages_fts_trigram VIRTUAL TABLEs if missing

  └─ Phase 1: FTS5 search
       └─ session_db.search_messages(
              query="auth tokens setup",
              limit=200, offset=0,
              # No source_filter — searches all sources by default (PR #1892)
          )
       └─ hermes_state.py:1904 → query = self._sanitize_fts5_query("auth tokens setup")
            └─ Step 1: extract balanced "quoted phrases" → no-op for this input
            └─ Step 2: strip [+{}()"^] → no-op
            └─ Step 3: collapse repeated * → no-op
            └─ Step 4: strip dangling boolean operators → no-op
            └─ Step 5: wrap dotted/hyphenated identifiers → no-op (no dots/hyphens)
            └─ Returns "auth tokens setup"
       └─ is_cjk = _contains_cjk(query) → False, takes the default FTS5 path
       └─ SQL:
            SELECT m.id, m.session_id, m.role,
                   snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet,
                   m.content, m.timestamp, m.tool_name,
                   s.source, s.model, s.started_at AS session_started
            FROM messages_fts
            JOIN messages m ON m.id = messages_fts.rowid
            JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT 200 OFFSET 0
       └─ Returns list[{id, session_id, role, snippet, ...}]

  └─ Phase 2: group by session, take top max_sessions=3 unique
       └─ Pseudocode:
            seen_sessions = []
            for hit in matches:
                if hit.session_id not in seen_sessions:
                    seen_sessions.append(hit.session_id)
                if len(seen_sessions) >= 3:
                    break

  └─ Phase 3: load each session's full transcript
       └─ For each of 3 sessions:
            messages = session_db.get_session_messages(session_id)
            full_text = _format_conversation(messages)  # session_search_tool.py:79
            preview = _truncate_around_matches(full_text, query, max_chars=100_000)
                 └─ session_search_tool.py:113
                 └─ Center the 100k-char window on positions where query terms appear
                 └─ Phrase > co-occurrence > individual term position

  └─ Phase 4: LLM summarization (concurrent, capped at auxiliary.session_search.max_concurrency=3)
       └─ async with asyncio.Semaphore(max_concurrency):
            for preview in previews:
                async_call_llm(
                    auxiliary="session_search",  # routes via aux client
                    messages=[
                        {"role": "system", "content": <focused_summarization_prompt>},
                        {"role": "user", "content": f"Query: {query}\n\nTranscript:\n{preview}"},
                    ],
                    max_tokens=MAX_SUMMARY_TOKENS,  # 10000
                )

  └─ Phase 5: return structured result to the agent
       └─ Each entry:
            {
              "session_id": "...",
              "started_at": "May 03, 2026 at 02:14 PM",
              "source": "cli",
              "model": "anthropic/claude-opus-4-7",
              "match_count": 12,
              "summary": "<3-paragraph summary of what happened, focused on the query>"
            }
       └─ Returns json.dumps(results, indent=2)

[The agent receives the summary in its tool result and can reference past work in its reply.]
```

## Architectural decisions

### AD-1: Two FTS5 tables — default + trigram — for international script support

- **Decision**: Maintain `messages_fts` (default unicode61 tokenizer) AND `messages_fts_trigram` (trigram tokenizer) in parallel. Route CJK queries to the trigram table.

- **Evidence**: `hermes_state.py:253-306` defines both tables and their maintenance triggers.

  ```sql
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content);

  -- For CJK substring search: trigram creates overlapping 3-byte sequences.
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
      content,
      tokenize='trigram'
  );
  ```

  Routing logic at `hermes_state.py:1959-1976`:

  ```python
  is_cjk = self._contains_cjk(query)
  if is_cjk:
      ...
      if cjk_count >= 3 and not _any_short_cjk:
          # Trigram FTS5 path
      else:
          # LIKE fallback for 1-2 CJK char queries
  ```

- **Rationale**: The default unicode61 tokenizer splits CJK characters into single-byte tokens. Per the comment at `hermes_state.py:278-281`: "The default tokenizer splits CJK characters into individual tokens, breaking phrase matching. The trigram tokenizer creates overlapping 3-byte sequences so substring queries work natively for any script (CJK, Thai, etc.)." Trigram doesn't replace the default — it complements it. Both tables are populated by the same triggers.

- **TypeScript translation**: We will set up two FTS5 tables identically in our schema. The router function (`messagesContainCjk(query)`) detects CJK code points (`hermes_state.py:1851-1858` lists the ranges). Trigram queries when CJK ≥3; LIKE fallback otherwise.

### AD-2: Six-step query sanitizer preserves intent, prevents syntax errors

- **Decision**: Before passing user input to FTS5 MATCH, run a six-step sanitizer that (1) preserves quoted phrases, (2) strips unmatched specials, (3) normalises `*` for prefix queries, (4) strips dangling boolean operators, (5) auto-quotes dotted/hyphenated identifiers, (6) restores preserved phrases.

- **Evidence**: `hermes_state.py:1797-1847` — entire `_sanitize_fts5_query` function. Particularly step 5 at `:1835-1841`:

  ```python
  # Step 5: Wrap unquoted dotted and/or hyphenated terms in double
  # quotes.  FTS5's tokenizer splits on dots and hyphens, turning
  # ``chat-send`` into ``chat AND send`` and ``P2.2`` into ``p2 AND 2``.
  # Quoting preserves phrase semantics.  A single pass avoids the
  # double-quoting bug that would occur if dotted, hyphenated and underscored
  # patterns were applied sequentially (e.g. ``my-app.config``).
  sanitized = re.sub(r"\b(\w+(?:[._-]\w+)+)\b", r'"\1"', sanitized)
  ```

- **Rationale**: User queries contain meaningful punctuation. "P2.2" is a sprint identifier; "chat-send" is a method name; "my-app.config" is a filename. Without auto-quoting, FTS5's tokenizer breaks them into AND-joined terms and the user's intent is lost.

  Each step came from a specific bug. PR #1776 (v0.4) fixed hyphenated queries. PR #16915 (v0.12) added underscored term quoting. The function evolved.

- **Alternative rejected**: Reject unsafe characters with an error. Too user-hostile; queries that "look reasonable" should just work.

- **TypeScript translation**: Verbatim port. The regex `\b(\w+(?:[._-]\w+)+)\b` works the same in JavaScript. The placeholder pattern (`\x00Q{i}\x00`) for preserving quoted strings works the same. Test cases must cover: quoted phrases survive, dotted identifiers get quoted, dangling boolean operators get stripped.

### AD-3: WAL with DELETE fallback for NFS/SMB/FUSE

- **Decision**: Try `PRAGMA journal_mode=WAL` first. If it fails with a known marker ("locking protocol", "not authorized", "disk i/o error"), fall back to `journal_mode=DELETE`.

- **Evidence**: `hermes_state.py:128-161`:

  ```python
  def apply_wal_with_fallback(conn, *, db_label="state.db") -> str:
      try:
          conn.execute("PRAGMA journal_mode=WAL")
          return "wal"
      except sqlite3.OperationalError as exc:
          msg = str(exc).lower()
          if not any(marker in msg for marker in _WAL_INCOMPAT_MARKERS):
              raise
          _log_wal_fallback_once(db_label, exc)
          conn.execute("PRAGMA journal_mode=DELETE")
          return "delete"
  ```

  Markers at `hermes_state.py:54-58`:

  ```python
  _WAL_INCOMPAT_MARKERS = (
      "locking protocol",       # SQLITE_PROTOCOL on NFS/SMB
      "not authorized",         # Some FUSE mounts block WAL pragma outright
      "disk i/o error",         # Flaky network FS during WAL setup
  )
  ```

- **Rationale**: WAL requires shared memory + fcntl byte-range locks that don't work reliably on network filesystems. Without the fallback, every `state.db` operation on an NFS-mounted home dir fails silently — `/resume`, `/title`, `/history`, `/branch`, kanban — all break. With DELETE mode, concurrent readers are serialised but the feature *works*. The user gets a single deduplicated WARNING explaining why.

- **TypeScript translation**: `better-sqlite3` exposes `db.pragma('journal_mode = WAL')` which can throw `SqliteError`. Same try/catch fallback pattern. WSL1 users specifically benefit from this.

### AD-4: Triggers auto-maintain the FTS index on every INSERT/UPDATE/DELETE

- **Decision**: SQL triggers on the `messages` table propagate every change into both FTS5 tables. Manual reindexing is not required.

- **Evidence**: `hermes_state.py:258-275` (default tokenizer triggers) and `:288-305` (trigram triggers). Each trigger includes `tool_name` and `tool_calls` in the indexed content via `COALESCE`:

  ```sql
  INSERT INTO messages_fts(rowid, content) VALUES (
      new.id,
      COALESCE(new.content, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.tool_calls, '')
  );
  ```

- **Rationale**: Including tool_name and tool_calls in the index means searching for "patch" surfaces messages where the agent called the `patch` tool. PR #16914 (v0.12) added this; before, tool-call messages weren't searchable by their tool name.

- **TypeScript translation**: `better-sqlite3` supports `CREATE TRIGGER` natively. Verbatim port.

### AD-5: Snippet() function returns highlighted excerpts

- **Decision**: Search results use SQLite's `snippet(messages_fts, 0, '>>>', '<<<', '...', 40)` function to return matched excerpts with delimiters around the matched terms.

- **Evidence**: `hermes_state.py:1935`:

  ```sql
  snippet(messages_fts, 0, '>>>', '<<<', '...', 40) AS snippet
  ```

  Parameters: column index 0, start marker `>>>`, end marker `<<<`, ellipsis `...`, context length 40 tokens.

- **Rationale**: Raw `content` is too long for a search result list. Snippet returns just the relevant portion with highlights. The agent gets enough context to decide which sessions to deep-dive on.

- **TypeScript translation**: `snippet()` is a SQLite built-in available in `better-sqlite3`. Same SQL.

### AD-6: Two-phase search — FTS5 hit → LLM summarization

- **Decision**: The user-facing tool returns LLM-summarized session digests, not raw FTS hits. The summarization model is configured via `auxiliary.session_search` (which falls through to the main model by default).

- **Evidence**: `session_search_tool.py:1-17` (module docstring):

  ```
  Flow:
    1. FTS5 search finds matching messages ranked by relevance
    2. Groups by session, takes the top N unique sessions (default 3)
    3. Loads each session's conversation, truncates to ~100k chars centered on matches
    4. Sends to the configured auxiliary model with a focused summarization prompt
    5. Returns per-session summaries with metadata
  ```

- **Rationale**: Raw FTS hits are noise. A 40-token snippet × 20 hits gives the agent fragments without continuity. Summarization compresses each session into a paragraph the agent can use.

- **TypeScript translation**: `Memory.searchAllSessions(query, { summarize: true })` invokes the LLM pass. With `summarize: false`, returns raw hits — useful for debugging or dashboard UI.

### AD-7: Truncate transcript around match positions, not from beginning

- **Decision**: When loading a session for summarization, truncate to ~100k chars by *centering* the window on positions where query terms appear, prioritising phrase matches, then co-occurrence, then individual term positions.

- **Evidence**: `session_search_tool.py:113-197` — entire `_truncate_around_matches` function.

  ```python
  Strategy (in priority order):
  1. Try to find the full query as a phrase (case-insensitive).
  2. If no phrase hit, look for positions where all query terms appear
     within a 200-char proximity window (co-occurrence).
  3. Fall back to individual term positions.

  Once candidate positions are collected the function picks the window
  start that covers the most of them.
  ```

- **Rationale**: A 200-turn session won't fit in the summarizer's context window. Random truncation throws away the relevant turns. Centering on match positions keeps the relevant content and discards the noise.

- **TypeScript translation**: Direct port. JavaScript regex with the same priority pattern.

### AD-8: Concurrent summarization with semaphore-bounded parallelism

- **Decision**: When summarizing N sessions, run the LLM calls concurrently with a semaphore. Default concurrency: 3, max 5, configurable via `auxiliary.session_search.max_concurrency`.

- **Evidence**: `session_search_tool.py:32-50` reads config. `:461-484` (asyncio.gather with semaphore inside `_summarize_all`).

- **Rationale**: Sequential summarization would take 3× longer than parallel. Capping at 3-5 prevents the user from hitting rate limits during a single search.

- **TypeScript translation**: `Promise.all` with `p-limit`-style concurrency limiter. Same default of 3, same config knob.

### AD-9: Search-source filtering, default = ALL sources

- **Decision**: `search_messages` accepts `source_filter` and `exclude_sources`. The default is to search *all* sources (CLI, telegram, discord, etc.).

- **Evidence**: PR #1892 (v0.4) — "search all sources by default in session_search". Previously, only the current source was searched, which surprised users who chatted across platforms.

- **Rationale**: A user converses with the same agent on the CLI at work, Telegram while commuting, Discord at home. They expect their "auth tokens" question to find the answer regardless of platform.

- **TypeScript translation**: `Memory.searchAllSessions(query, { sourceFilter?, excludeSources? })`. Both optional. Default behaviour: search all.

### AD-10: Write retries with random jitter to prevent WAL convoy

- **Decision**: When SQLite returns `BUSY` during a write, retry with random delay 20–150ms, up to 15 retries. Avoids the deterministic-backoff convoy effect that caused 15-20s TUI freezes.

- **Evidence**: `hermes_state.py:317-330`:

  ```python
  # ── Write-contention tuning ──
  # With multiple hermes processes (gateway + CLI sessions + worktree agents)
  # all sharing one state.db, WAL write-lock contention causes visible TUI
  # freezes.  SQLite's built-in busy handler uses a deterministic sleep
  # schedule that causes convoy effects under high concurrency.
  #
  # Instead, we keep the SQLite timeout short (1s) and handle retries at the
  # application level with random jitter, which naturally staggers competing
  # writers and avoids the convoy.
  _WRITE_MAX_RETRIES = 15
  _WRITE_RETRY_MIN_S = 0.020   # 20ms
  _WRITE_RETRY_MAX_S = 0.150   # 150ms
  ```

- **Rationale**: PR #3385 (v0.5) fix: "SQLite WAL write-lock contention causing 15-20s TUI freeze." SQLite's default busy handler uses fixed-delay retries; when N writers all hit BUSY at the same time, they all sleep, then all wake at the same time, then all hit BUSY again — convoy. Jitter randomises the wake-up times.

- **TypeScript translation**: `better-sqlite3` is synchronous; we implement the same jittered-retry loop. Wrap `db.transaction(...)` with a retry decorator.

### AD-11: Periodic PASSIVE WAL checkpoint every 50 writes

- **Decision**: After every 50 successful writes, attempt a `PRAGMA wal_checkpoint(PASSIVE)` to flush the WAL file back to the main DB.

- **Evidence**: `hermes_state.py:330`:

  ```python
  # Attempt a PASSIVE WAL checkpoint every N successful writes.
  _CHECKPOINT_EVERY_N_WRITES = 50
  ```

- **Rationale**: Without checkpoints, the WAL file grows unbounded. PASSIVE mode is non-blocking — checkpoints only what's safe to checkpoint without contending with readers.

- **TypeScript translation**: Same constant, same pragma call. After 50 commits, run `db.pragma('wal_checkpoint(PASSIVE)')`.

### AD-12: Schema version with migration runner

- **Decision**: `schema_version` table holds the current schema version. `SCHEMA_VERSION = 11` (per `hermes_state.py:36`). On every connect, compare and run migrations forward.

- **Evidence**: `hermes_state.py:36` and `:186-188`:

  ```python
  SCHEMA_VERSION = 11
  ...
  CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
  );
  ```

- **Rationale**: Hermes has bumped the schema 11 times (v6 added reasoning columns per v0.5 #2974). Each bump needs a forward migration runner so existing user state.db files upgrade automatically.

- **TypeScript translation**: Migration runner with explicit version handlers (`migrations/001-init.ts`, `migrations/002-add-reasoning.ts`, etc.). Strict forward-only.

## Data structures

### Persisted

**Path**: `~/.hermes/state.db`. Resolved via `DEFAULT_DB_PATH = get_hermes_home() / "state.db"` at `hermes_state.py:34`.

**Format**: SQLite (WAL or DELETE journal mode).

**Schema** (relevant sections from `hermes_state.py:185-251`):

```sql
CREATE TABLE schema_version (
    version INTEGER NOT NULL
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,                  -- e.g. "ses_2026_05_07_abc123"
    source TEXT NOT NULL,                 -- "cli" | "telegram" | "discord" | ...
    user_id TEXT,                         -- platform user id, when known
    model TEXT,
    model_config TEXT,                    -- JSON
    system_prompt TEXT,
    parent_session_id TEXT,               -- compression chain
    started_at REAL NOT NULL,
    ended_at REAL,
    end_reason TEXT,
    message_count INTEGER DEFAULT 0,
    tool_call_count INTEGER DEFAULT 0,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    reasoning_tokens INTEGER DEFAULT 0,
    billing_provider TEXT,
    billing_base_url TEXT,
    billing_mode TEXT,
    estimated_cost_usd REAL,
    actual_cost_usd REAL,
    cost_status TEXT,
    cost_source TEXT,
    pricing_version TEXT,
    title TEXT,                            -- auto-generated session title
    api_call_count INTEGER DEFAULT 0,
    handoff_state TEXT,
    handoff_platform TEXT,
    handoff_error TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,                    -- system | user | assistant | tool
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,                       -- JSON
    tool_name TEXT,
    timestamp REAL NOT NULL,
    token_count INTEGER,
    finish_reason TEXT,
    reasoning TEXT,                        -- separate field for thinking content
    reasoning_content TEXT,
    reasoning_details TEXT,
    codex_reasoning_items TEXT,
    codex_message_items TEXT
);

CREATE TABLE state_meta (
    key TEXT PRIMARY KEY,
    value TEXT                              -- arbitrary key-value (goals, settings)
);

CREATE INDEX idx_sessions_source ON sessions(source);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX idx_messages_session ON messages(session_id, timestamp);
```

**FTS5 tables** (`hermes_state.py:253-306`):

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(content);
CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(content, tokenize='trigram');
```

Both have AFTER INSERT/DELETE/UPDATE triggers on `messages` that index content + tool_name + tool_calls.

**Lifecycle**:
- Schema initialized on first SessionDB() call.
- Migrations run forward to `SCHEMA_VERSION = 11` on every open.
- Periodic PASSIVE checkpoint flushes WAL every 50 writes.
- Sessions are *never* deleted — `ended_at` and `end_reason` mark them ended.

### In-memory

Per-instance state on `SessionDB`:

- `self._conn` — single `sqlite3.Connection` (thread-safe with WAL).
- `self._lock` — `threading.Lock` for serializing certain operations.
- `self._write_count` — checkpoint trigger counter.

Module-level globals:

- `_last_init_error: Optional[str]` (with `_last_init_error_lock`) — last init failure message.
- `_wal_fallback_warned_paths: set[str]` (with `_wal_fallback_warned_lock`) — dedup logger.

### Concurrency model

- **One DB, many processes**: gateway + CLI + worktree agents all share `state.db`.
- **WAL mode**: concurrent readers + one writer.
- **Jittered retries** on `BUSY`: 20-150ms × 15 max.
- **PASSIVE checkpoint** every 50 writes — non-blocking.
- **Thread lock** (`self._lock`) for the checkpoint-counter increment.

## Failure modes Hermes already fixed

### 1. NFS/SMB/FUSE breaks WAL with "locking protocol" error

- **What can go wrong**: User's `~` is on an NFS mount. `PRAGMA journal_mode=WAL` raises `SQLITE_PROTOCOL`. Every feature backed by state.db breaks silently.
- **How Hermes handles it**: `apply_wal_with_fallback` at `hermes_state.py:128`. Falls back to `journal_mode=DELETE`, logs one WARNING per (process, db_label), continues.

### 2. WAL convoy causes 15-20s TUI freezes (#3385)

- **What can go wrong**: N gateway processes hit BUSY at the same time, all sleep on SQLite's fixed-delay handler, all wake at the same time, all hit BUSY again. Frozen UI.
- **How Hermes handles it**: Application-level jittered retries (AD-10). PR #3385.

### 3. Hyphenated/dotted queries tokenize incorrectly

- **What can go wrong**: `chat-send` → `chat AND send` (zero results). `P2.2` → `p2 AND 2`. `my-app.config.ts` → nothing matches.
- **How Hermes handles it**: Step 5 of `_sanitize_fts5_query` auto-quotes `\b\w+(?:[._-]\w+)+\b`. PR #1776 (initial), PR #16915 (underscore support).

### 4. CJK queries return false positives

- **What can go wrong**: `大别山项目` becomes `大 AND 别 AND 山 AND 项 AND 目` in the default tokenizer. Hits any message with any of those characters — flood of false positives.
- **How Hermes handles it**: Parallel trigram FTS5 table. PR #16651 by @alt-glitch. Routing logic at `hermes_state.py:1959-1976`.

### 5. Short CJK queries (<3 chars) match nothing in trigram

- **What can go wrong**: Trigram requires ≥3 CJK characters to match. Query `"广西 OR 桂林"` has `cjk_count=6` but each token is 2 chars — trigram returns 0.
- **How Hermes handles it**: Per-token CJK length check at `hermes_state.py:1965-1974`. Routes to LIKE when any non-operator token has <3 CJK chars.
- **Evidence**: PR #20494.

### 6. tool_name and tool_calls not indexed (#16914)

- **What can go wrong**: Search for "patch" misses messages where the agent called the `patch` tool because the tool name lived in the `tool_name` column, not `content`.
- **How Hermes handles it**: Triggers concatenate `content || tool_name || tool_calls` into the FTS content. Repair + migration handles existing DBs.

### 7. Corrupt session message rows crash load_transcript

- **What can go wrong**: A malformed row (truncated JSON in `tool_calls`, etc.) raises during `load_transcript`. Whole session fails to load.
- **How Hermes handles it**: PR #1744 (v0.4) — `skip corrupt lines in load_transcript instead of crashing`. Skip + log.

### 8. Session search crashes when no sessions exist

- **What can go wrong**: User calls `session_search` on a fresh install. No sessions, the search SQL returns 0 rows. Naïve `result[0]` crashes.
- **How Hermes handles it**: PR #2194 (v0.4).

### 9. Search filter normalisation collapses case-sensitive duplicates

- **What can go wrong**: Sessions exist with `source = "Telegram"` and `source = "telegram"`. Filtering by either misses some.
- **How Hermes handles it**: PR #2157 (v0.4) — normalise session keys at write time.

### 10. Schema migration mid-conversation reorders columns, breaks select

- **What can go wrong**: A new schema_version adds columns. Existing prepared SELECTs that rely on positional column indexing return wrong values.
- **How Hermes handles it**: Always select by column name (`row["session_id"]` not `row[0]`). Schema bumps include ADD COLUMN, not ALTER reorder.

### 11. `messages_fts.rowid` desync from `messages.id`

- **What can go wrong**: A direct `DELETE FROM messages_fts` without corresponding `DELETE FROM messages` leaves orphans. Search returns hits pointing to deleted messages.
- **How Hermes handles it**: All deletes go through the triggers — never manual FTS deletes. Tests assert rowid parity.

### 12. WAL fallback warning floods errors.log

- **What can go wrong**: Kanban opens `state.db` connections constantly. Without dedup, the WAL warning fires hundreds of times per hour on NFS.
- **How Hermes handles it**: `_log_wal_fallback_once` at `hermes_state.py:164-183`. One warning per (process, db_label).

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export { Memory } from "./memory";

declare module "./memory" {
  interface Memory {
    /**
     * Search all sessions in the SessionDB via FTS5.
     *
     * By default returns LLM-summarized session digests (3 paragraphs each).
     * Pass `summarize: false` to get raw FTS hits.
     */
    searchAllSessions(query: string, options?: SearchAllSessionsOptions): Promise<SessionSearchResult>;
  }
}

export interface SearchAllSessionsOptions {
  /** Maximum sessions to summarize (default 3, max 5). */
  maxSessions?: number;
  /** Filter to specific sources (e.g. ["cli", "telegram"]). Default: all. */
  sourceFilter?: string[];
  /** Exclude specific sources. */
  excludeSources?: string[];
  /** Filter by message role (e.g. ["user", "assistant"]). */
  roleFilter?: Array<"user" | "assistant" | "system" | "tool">;
  /** Return raw FTS hits without LLM summarization. Default true (summarize). */
  summarize?: boolean;
  /** Concurrency for parallel LLM summarization. Default 3, max 5. */
  maxConcurrency?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface SessionSearchResult {
  sessions: SessionSearchEntry[];
  /** Total FTS5 hit count before grouping by session. */
  totalHits: number;
}

export interface SessionSearchEntry {
  sessionId: string;
  startedAt: string;
  source: string;
  model: string | null;
  matchCount: number;
  /** Set when summarize=true. */
  summary?: string;
  /** Set when summarize=false. */
  rawHits?: Array<{
    messageId: number;
    role: string;
    snippet: string;
    timestamp: number;
  }>;
}
```

### Internal module layout

```
packages/sdk/src/internal/session-db/
├── connection.ts                # SessionDB class — opens better-sqlite3 connection
├── wal-fallback.ts              # applyWalWithFallback (NFS/SMB/FUSE detection)
├── schema.sql                   # Verbatim of hermes_state.py:185-306
├── schema-version.ts            # SCHEMA_VERSION constant
├── migrations/
│   ├── 001-init.ts
│   ├── 002-add-reasoning-cols.ts
│   └── …                        # One per schema bump
├── retry-jitter.ts              # withWriteRetry(fn) — jittered retry helper
├── checkpoint.ts                # Periodic PASSIVE checkpoint after N writes
├── fts5/
│   ├── sanitize.ts              # _sanitize_fts5_query — verbatim 6-step
│   ├── cjk.ts                   # CJK code-point ranges + detection
│   ├── search-messages.ts       # search_messages — default + trigram routing
│   └── search-sessions.ts       # search_sessions — session-level filter
├── messages.ts                  # CRUD on messages table
├── sessions.ts                  # CRUD on sessions table
└── state-meta.ts                # state_meta key/value access (for goals, settings)

packages/sdk/src/internal/session-search/
├── tool.ts                      # session_search tool implementation
├── truncate.ts                  # _truncate_around_matches
├── summarize.ts                 # _summarize_session via auxiliary LLM
└── prompts.ts                   # Summarization prompt templates
```

### Persistence layout

```
~/.theokit/state.db        # All session data + FTS5 index
~/.theokit/state.db-wal    # WAL sidecar (when WAL mode active)
~/.theokit/state.db-shm    # Shared memory sidecar (WAL mode)
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `better-sqlite3` | Synchronous SQLite with FTS5 | Always — required for this feature. |
| Existing OpenAI/Anthropic SDK | LLM summarization | Already a peer dep. |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. `Memory.searchAllSessions` is new.
- **Breaking signature changes**: None.
- **Migration path**: User must have a populated `state.db`. SDK provides `Memory.recordSession(...)` for SDK consumers to feed sessions in. For users migrating from session JSON files, a one-shot `Memory.importLegacySessions(dir)` helper is recommended.

## Test strategy

Hermes tests to port:

- `tests/test_hermes_state.py` — SessionDB unit tests
- `tests/tools/test_session_search.py` — full search + summarization pipeline

**Unit tests**:
- `_sanitizeFts5Query`: 30+ cases. Each step has its own test. Edge cases: empty, all-special, mixed quoted/unquoted, dangling `AND`/`OR`/`NOT`, dotted+hyphenated identifiers.
- CJK detection: each Unicode range, mixed CJK + Latin, kana, hangul.
- Trigram routing: CJK ≥3 chars → trigram; CJK <3 → LIKE.
- Schema migrations: each version bump has a forward migration test.
- WAL fallback: simulate `OperationalError("locking protocol")`, assert DELETE mode active.
- Jittered retry: simulate BUSY 14 times, assert success on 15th, assert delay variance.

**Integration tests** (real SQLite):
- Insert 1000 messages across 50 sessions, run search, assert correct ranking.
- CJK content: insert Chinese/Japanese/Korean messages, search, assert trigram hits.
- Concurrent writes: spawn 5 worker threads each writing 100 messages, assert no data loss.
- Schema upgrade: install with old version, open with new, assert schema_version bumped and migrations ran.

**Property tests** (`fast-check`):
- For any input query, `sanitizeFts5Query` produces a string that does not raise when passed to `SELECT * FROM messages_fts WHERE messages_fts MATCH ?`.
- For any set of inserted messages, FTS index size = messages table size (no orphans).

**Real-LLM tests**:
- Populate a real session, fire `searchAllSessions`, assert LLM summary mentions specific facts from the session.

**Examples to ship**:
- `examples/cross-session-search/` — basic search + summary
- `examples/cross-session-search-cjk/` — Chinese-language search demo

## Open questions

- **Schema version**: Hermes is at 11; do we start fresh at 1 for `@usetheo/sdk` or maintain compat with Hermes' schema? Recommend fresh (incompatible state.db files between Hermes and TheoKit anyway, since session ID formats differ).
- **`state_meta` table**: Used for goals (`02-runUntil-goal.md`) and other key-value state. Should we expose it as `Memory.setMeta(key, value)` / `Memory.getMeta(key)` or keep it internal?
- **Message limits for summarization**: 100k chars per session, 10k summary tokens. These match GPT-4-class context windows. For smaller-context models (8k), the truncation needs to scale down.
- **Session source taxonomy**: Hermes uses `cli`, `telegram`, `discord`, etc. For TheoKit we'd have `sdk-direct`, `theokit`, plus user-defined. Need to pick the wire format and document.
- **Migration from JSONL**: Hermes had pre-FTS5 JSONL session files. Some users may still have them. Do we offer a one-shot import, or assume zero migration?

## References

- `referencia/hermes-agent/hermes_state.py:1-2966`
- `referencia/hermes-agent/tools/session_search_tool.py:1-612`
- `referencia/hermes-agent/RELEASE_v0.5.0.md` PR #3385 (WAL contention fix)
- `referencia/hermes-agent/RELEASE_v0.12.0.md` PR #16651 (trigram CJK), #16914 (tool_name+tool_calls indexing), #16915 (underscore quoting)
- `referencia/hermes-agent/RELEASE_v0.4.0.md` PR #1776 (hyphenated queries), #1892 (search all sources default), #1744 (corrupt line skip), #2157 (case normalization), #2194 (empty-sessions crash fix)
- SQLite docs: https://www.sqlite.org/fts5.html (FTS5 reference)
- Theokit ADRs:
  - D6 — `pnpm validate` strict — better-sqlite3 must pass attw and publint
  - D43 — LanceDB backend for Memory.index — separate from FTS5; LanceDB is vector, FTS5 is keyword
  - D45 — `SDKObjectDelta` is variant of SDKMessage — unrelated, but reminder that we have other streamable surfaces
