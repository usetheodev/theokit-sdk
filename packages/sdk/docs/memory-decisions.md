# Memory subsystem — decisions that are not obvious from the code

Five decisions that a reader would otherwise be right to call bugs. Each names where the behaviour
lives, so the next person to touch it can disagree on purpose rather than "fix" it by accident.

Written after a conformance audit against an external memory contract found that three of these
existed only in commit messages and one only in a conversation. A decision nobody can find is a
decision the next refactor deletes.

---

## 1. Running an agent creates `.theokit/`, even when memory goes to the Claude Code directory

**What happens.** Reading a Claude Code project creates nothing. Running an agent creates:

```
.theokit/agents/registry.json          on Agent.create
.theokit/memory/.index/memory.sqlite   on the first send, when memory is enabled
```

**Why it looks wrong.** With `memory.directory` pointed at the CLI's store, memory _facts_ are
written to `<claudeHome>/projects/<encoded-cwd>/memory/` — where the CLI reads them. So a project
that never adopted this SDK ends up with a `.theokit/` directory anyway, which reads like the
"write where the CLI reads" promise leaking.

**Why it is right.** What lands in `.theokit/` is this SDK's own state, and neither piece has a
Claude Code shape to be written in:

- `agents/registry.json` is the live-agent address book (`internal/runtime/registry/agent-registry.ts`).
  The CLI has no equivalent.
- `memory/.index/memory.sqlite` is the search index (`sdk-memory/internal/index/index-db.ts:84-91`).
  **The CLI has no index format**, so there is no CLI location that could hold it. Putting it beside
  the facts in the CLI's directory would put a binary artefact the CLI does not understand inside a
  directory the CLI manages.

The facts — the thing a user recorded and would lose — go where the CLI reads. The index is derived
data that can be rebuilt from them.

**Scope, narrowed 2026-09-04 (theokit-sdk#554).** This argument reaches the CLI's directory and no
other. For any other `memory.directory`, the index now follows the store —
`<directory>/.index/memory.sqlite` — and the reason the old behaviour was wrong is worth keeping:

> The index is **not** a pointer. `chunks.text` holds the fact TEXT, because FTS5/BM25 needs it to
> search, and `files.path` holds the store's absolute path. So a copy of the index is a copy of the
> memory, readable with `strings`.

Leaving it in `<cwd>` while the facts moved therefore wrote one operator's personal store into
**every repository the agent ran in**, untracked and un-ignored. "Derived data" was true of its
_derivability_ and false of its _contents_, and the sentence above was doing the work of both.

The CLI case survives unchanged, on its own argument: that partner has no index format, so a binary
there is an artefact it does not understand inside a directory it manages. `memoryIndexRoot`
(`internal/memory/storage/memory-root.ts`) is the single place that decides, using the same
path-only test `indexBudgetWarning` relies on.

**How to check the narrowed scope still holds:** `tests/memory/index-follows-a-relocated-store.test.ts`
pins both halves — a plain directory takes its own index, the CLI's does not — and
`tests/memory/root.test.ts` carries the end-to-end pair through `IndexManager.open`.

**How to check it still holds:** `tests/claude-code-e2e-compat.test.ts`, the pair
`test_reading_a_cli_project_creates_nothing_in_it` /
`test_running_an_agent_creates_theokit_and_only_sdk_state_in_it`. The second exists so the first is
not vacuous — it asserts the directory contains _only_ `agents` and `memory`.

---

## 2. Four memory kinds, and a kind is never inferred

`internal/memory/types.ts:32` declares `user | feedback | project | reference`, validated at the
storage boundary (`internal/memory/storage/markdown-store.ts:195`, `invalid_memory_kind`).

**Known divergence.** An external contract this SDK was audited against specifies **nine** kinds in
three retention buckets (atomic / consolidatable / lifecycle-managed). This SDK has four.

**Why it has not been widened.** The nine exist to drive differentiated retention, and **this SDK has
no retention at all** — no TTL, no pruning, no decay (searched `ttl|prune|expire|retention` across
both packages; the only hits are the recall result cache, which expires _results_, not entries).
Nine names over a regime where nothing expires are nine names for one behaviour. Retention has to
exist before a vocabulary that differentiates it is worth anything.

> **One of this argument's two legs has since been removed, and the note stays so the argument
> cannot be defended with it later.** An earlier version of this section also said "and no buckets".
> That stopped being true in `a655ac4d`: `dreaming/phases.ts:48-49` now has `ATOMIC_KINDS` and
> `CONSOLIDATABLE_KINDS`, and `dedupPolicy` grades three levels by them. The buckets exist; what
> still does not exist is the retention they would govern.

**The stronger reason, found after the first one weakened: the four are not a subset, they are the
partner's vocabulary.** This store's format is shared with the Claude Code CLI, and every memory the
CLI has written on one developer machine — 688 files, 2026-08 — carries one of exactly these four:

```
425 project    167 feedback    74 reference    7 user    (15 with no type)
```

Zero others. Adding a fifth value means writing files whose `type` the interop partner has never
emitted. That is evidence about what it WRITES, not proof about what it ACCEPTS on read — but it
means there is no precedent, and the burden belongs to whoever adds one unilaterally.

**`failure_heuristic` is the one the retention argument does not cover, and the interop argument
does.** It changes _what is written_ (a trigger→resolution pair) rather than how an entry expires, so
"no retention to differentiate" says nothing about it — and nothing has adopted it (`grep
failure_heuristic packages/sdk/src` → zero). It is not declined on retention grounds; it is held by
the same shared-format question as the other four, and unblocking it means establishing what the CLI
does with a `type` it does not emit.

**The part that is not negotiable:** a kind is never inferred (`types.ts:29`). A wrong kind is worse
than none, because it makes retention and recall confident about the wrong thing.

---

## 3. Re-recording a fact overwrites it; there is no `Invalidated` state

`markdown-store.ts:204` writes `<slug>.md` through `replaceFileAtomic`, and `nextIndex`
(`:222-235`) keeps exactly one index line per name.

**Known divergence.** The same external contract requires a contradiction to produce an
`Invalidated` entry plus a supersession chain, not an overwrite.

**Why the index is right as it is.** The index is a map from memory to file. Two lines for one file
is a map that disagrees with itself, and the CLI reads that index.

**What the entry is NAMED by changed, and it is worth knowing why.** The slug and the index title
used to be the fact's whole sentence. They are now a short topic name — `MemoryFact` carries optional
`title` and `description` so a writer can author them, and derives them when it does not. The
derivation is mechanical on purpose and does not pretend to be authorship, the same rule this store
applies to `kind`.

**Two distinct facts that share a subject now coexist; they used to overwrite each other.** A topic
slug is a lossy summary, and lossy summaries collide: `"fact A"`, `"fact B"` and `"fact C"` all
derive `fact`. Naming by the whole sentence made collisions rare by accident; naming by subject made
them ordinary. `resolveName` (`markdown-store.ts:280`) settles it by the only thing that can — the
text: the same text keeps the same file and increments corroboration, different text takes
`topic-2`. Found by the golden `multiple appends each get a file`, not by review — the failure was
silent data loss, and nothing about the reasoning would have surfaced it.

So the section heading stays true for what it describes, re-recording the _same_ fact, and the case
it never covered is now covered.

That change closed #446, where a passphrase the model had just refused to store was written into the
**filename** and the index line. The reason it works is that it is not a rule about secrets: a rule
about secrets has to recognise one, and `redactSecrets` had already demonstrated it does not
recognise `sirius-zzq417`. Naming the memory by its **subject** drops the tail of the sentence
whatever the tail happens to be. Closed by construction, not by detection — which is the only kind
of closure available when the dangerous input is indistinguishable from a safe one.

**Why this is still a gap.** "The index names the current entry" and "the store keeps the
supersession chain" are not in conflict — they are different files. The resolution, when it is
built, is the index pointing at the current entry while the entry file carries its own chain. What
exists today is only the first half.

---

## 4. The session transcript is a DAG, not a linear log

`internal/persistence/session-transcript.ts:4-11,77-78` — records carry `uuid`/`parentUuid`, and
`appendCompactBoundary` starts a new root.

**Deliberate and forced.** The format IS the Claude Code record shape. Bidirectional CLI
compatibility is a product requirement, so a linear session model is not available to choose: it
would make transcripts this SDK writes unreadable by the CLI and vice versa.

Where an external contract prescribes a linear session model, this is a documented middle-ground —
the contract is deciding a question that a SDK with an imposed wire format does not get to answer.

---

## 5. Recall is lexical by default; dense vectors only when a consumer asks for them

Two different things are called recall:

- **Default.** `internal/local-agent/local-agent-send.ts:257-272` reads the store, then ranks and
  cuts it through `selectFactsForInjection` — lexical relevance against the user's message, fused
  with recency, capped at 10 entries and a byte budget derived from 15,000 tokens. No embeddings on
  this path at all (`runtime/memory/select-facts.ts:117-118`).
- **The `memory_search` tool.** Its index is NOT opt-in: `local-agent-memory.ts:82-98` opens
  `IndexManager` whenever `memory.enabled` is true. The dense vectors are — `maybeCreateEmbeddingRuntime`
  (`:198-200`) returns `undefined` unless `memory.index.embedding` is configured, so by default the
  index runs text-only. The `vectorWeight ?? 0.6` blend at `index-manager-helpers.ts:21` weighs a
  vector that, unconfigured, was never computed.

So no dense vector participates in scoring under a default configuration. One does only when a
consumer names an embedding provider.

**Known divergence,** on the opt-in path: the external contract forbids dense vectors in agent-memory
recall below a measured threshold (>1000 entries _and_ demonstrated lexical degradation). Neither has
been measured here.

**The bigger gap WAS the default path, and it was not this divergence.** A contract arbitrating
_between_ retrieval methods does not cover the absence of one — and until `721a311f` there was no
method on this path at all. That is fixed; the history is kept because the failure mode is worth
recognising again, and because it explains why the ranking signal has to depend on the question. A
first version cut by recency alone, and a live run showed the answering fact dropped for being old
rather than irrelevant. Bounding cost and choosing what survives are two jobs, and a cap does only
the first.

**What that default path used to inject, measured 2026-08 against the published artefact.** 100 real stores on one developer machine, 687
entries, ~3.2 KB per entry. Feeding the largest — 66 entries, 275 KB on disk — to
`readFactsFromMarkdown` returns all 66 and **246K characters, roughly 66K tokens injected into every
turn's system prompt**, before the user has said anything. Nine more stores are already past the
point where the injection exceeds a session budget.

Two things make this worse than a size problem. The CLI's store is read **unconditionally** —
`memory.directory` decides where writes go, never what the read covers — so a consumer who never
opted into CLI interop still gets it. And the
cost is invisible: nothing errors, the window just fills, and the tokens are not attributed to
memory. An earlier version of this document said "at 64 entries it does not hurt" — that was an
assumption, and measuring it is what disproved it.

`metadata.modified` is already written (`markdown-store.ts:210`) and parsed (`:177`) and consumed by
nothing — the data for a staleness signal is on disk today, unused.

---

## One resolver, one root (#463)

**What happens.** `memory.directory` — absolute, or `~/`-prefixed — is the only thing that decides
where this agent's memory lives. Everything under the root follows it: `MEMORY.md`, the per-memory
files, `notes/`, `sessions/`, `wiki/`, `transcripts/`, `dream-diary.md` and `.index/memory.sqlite`.

**What it replaced.** The location used to be a side effect of `local.sessionDir`, the option that
names the _transcript_ home, on the reasoning that a consumer who set it had already opted into CLI
interop. One option answered two questions — and of the fourteen places that computed a memory
path, exactly one heard the second answer. `appendFact` relocated; the indexer, the `memory_get`
path guard, `MEMORY.md`, `sessions/` and the index database did not. A relocated fact was written,
never indexed, unreadable by the tool whose job is reading memory, and shadowed by a second
`MEMORY.md` in the store it had left.

**Why the root is a branded type.** `MemoryRoot` is `string` with a brand, produced only by
`resolveMemoryRoot`. A cwd and a root are both strings, so without the brand the thirteen path
helpers would go on accepting either, and the next helper added has the same even chance of taking
the wrong one that produced this defect. The brand makes "every path derives from one resolution" a
compiler rule instead of a convention.

**The gap that remains, stated rather than hidden.** `IndexManager.open()` is a public entry point
that takes a `cwd`, so its `memoryRoot` is optional and falls back to the default. Inside an agent
the root is resolved once and handed to both the index and the read tool; a consumer opening the
index by hand against a non-default directory has to pass it.

**A relative `directory` is refused, not resolved.** The two plausible bases — the workspace and the
process cwd — put the store in two different places, and picking one silently is how a store ends up
split across both. `ConfigurationError` with code `invalid_memory_directory`.

**How to check it still holds:** `tests/memory/root.test.ts`, in particular
`test_the_indexer_scans_the_configured_directory_so_the_fact_is_searchable` and
`test_the_project_store_gets_no_second_index_pointing_at_files_it_does_not_have` — the two halves
that were broken.

---

## Known gaps, recorded so they are not rediscovered

Each row says what would close it, not only that it is open — the two invite very different work.

| gap                                                                            | where                                                                                                          | what would close it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~The default recall path has no selection at all~~ — **closed** in `721a311f` | `local-agent-send.ts:257-272`                                                                                  | Closed: lexical relevance + recency, capped. Measured end to end against the real model — a 67-entry store went from ~66K to **13,606 tokens on the wire**, and the answering fact is recalled whether it is the oldest or the newest entry.                                                                                                                                                                                                                                                         |
| The CLI's store is read whether or not the consumer opted in                   | `storage/memory-root.ts` — `claudeProjectMemoryDir(cwd)` is an unconditional entry in `memoryReadRoots`        | A decision, not a fix: it is deliberate (_write one, read all_, so a consumer's existing memories are never orphaned) and it means a consumer who never opted into CLI interop still receives what the CLI accumulated in that project. Cheap while the cap holds; revisit if the cap is ever removed.                                                                                                                                                                                               |
| No retention of any kind — no TTL, prune, or decay                             | searched `ttl\|prune\|expire\|retention` across both packages: zero                                            | A per-kind TTL plus a prune step in the sweep. Needs the kind vocabulary to mean something first (§ 2), which is why this orders before widening it.                                                                                                                                                                                                                                                                                                                                                 |
| Quarantine marks but does not constrain                                        | `memory-file.ts:96`, `memory-provider.ts:48`                                                                   | Implemented: three states, and `[unconfirmed]` on entries the store counted once. **Measured against the real model and it does not close the hole** — a planted memory alone is acted on 5/5, and beside a corroborated contradiction it is still asserted ~62% of runs (n=32). Marking influences the model; it does not constrain it. The guarantee is not available at this layer: blocking an uncorroborated entry would break the promise that a fact written once is recallable next session. |
| A planted memory can make the agent ACT                                        | measured: `RELEASE_OVERRIDE.txt` created in 2 of 6 runs                                                        | Register the permission layer — `PermissionPlugin.create(new PermissionEngine(…))` — which blocks it every time. This is the half that IS closable at the tool boundary; the informational half above is not. Any deployment where the memory directory is writable by anything other than this agent needs it.                                                                                                                                                                                      |
| `description` is written as a copy of the body                                 | `markdown-store.ts:205-211` — the _reader_ (`:174-177`) already handles a distinct description correctly       | Stop writing one when nobody declared it. The role is a one-line recall aid; deriving it mechanically would be inferring the situation, which § 2's rule already forbids for `kind`. Absent is a valid state and the reader already falls back to the body.                                                                                                                                                                                                                                          |
| The topic-name deriver filters English function words only                     | `memory-file.ts:73`                                                                                            | A store in another language keeps that language's function words in the slug and the index title — `de`, `do`, `para` survive, so the name is longer and noisier. **Never lossy:** collisions are caught by `resolveName` comparing text, not by the stopword list. Real stores here are bilingual, so this is a partial parity, not a complete one. Closes with a per-language list, or by not needing one.                                                                                         |
| The dream sweep never filters by kind before dedup                             | `dreaming/phases.ts:34` — `lightPhase` never reads `kind`                                                      | Partition by kind before `lightPhase`. Nothing is deleted today, but a consolidated note can blend two distinct entries, and the note is what search returns.                                                                                                                                                                                                                                                                                                                                        |
| The dream sweep does not update the index                                      | `dreaming/run.ts:53-96` writes `notes/` and never syncs                                                        | An `IndexManager.sync` after `writeConsolidatedNotes`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Recall fires every turn, cached on query hash, not on store manifest           | `internal/local-agent/local-agent-memory.ts:87`; `sdk-memory/internal/active-memory/active-memory-cache.ts:66` | A second skip condition beside the existing one — hash of the store manifest, so an unchanged store skips even when the question changes. The query cache is not wrong; it answers a different question.                                                                                                                                                                                                                                                                                             |
