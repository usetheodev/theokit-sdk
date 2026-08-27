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

**Why it looks wrong.** With `local.sessionDir` set, memory *facts* are written to
`<sessionDir>/projects/<encoded-cwd>/memory/` — where the CLI reads them. So a project that never
adopted this SDK ends up with a `.theokit/` directory anyway, which reads like the "write where the
CLI reads" promise leaking.

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

**How to check it still holds:** `tests/claude-code-e2e-compat.test.ts`, the pair
`test_reading_a_cli_project_creates_nothing_in_it` /
`test_running_an_agent_creates_theokit_and_only_sdk_state_in_it`. The second exists so the first is
not vacuous — it asserts the directory contains *only* `agents` and `memory`.

---

## 2. Four memory kinds, and a kind is never inferred

`internal/memory/types.ts:32` declares `user | feedback | project | reference`, validated at the
storage boundary (`internal/memory/storage/markdown-store.ts:195`, `invalid_memory_kind`).

**Known divergence.** An external contract this SDK was audited against specifies **nine** kinds in
three retention buckets (atomic / consolidatable / lifecycle-managed). This SDK has four and no
buckets.

**Why it has not been widened.** The nine exist to drive differentiated retention, and **this SDK has
no retention at all** — no TTL, no pruning, no decay. Nine names over a regime where nothing expires
are nine names for one behaviour. Retention has to exist before a vocabulary that differentiates it
is worth anything.

`failure_heuristic` is the exception worth adopting independently, because it changes *what is
written* (a trigger→resolution pair) rather than how an entry expires.

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

## 5. The vector path is opt-in, and the default path does no retrieval at all

Two different things are called recall:

- **Default.** `internal/local-agent/local-agent-send.ts:259` reads **every** fact in the store into
  the `<memory>` block, every turn. No query, no ranking, no cap.
- **Opt-in.** `Memory.openIndex` / active memory score hybrid, weighted toward vectors —
  `internal/memory/index-manager-helpers.ts:21`, `vectorWeight ?? 0.6` — over agent memory files.

**Known divergence,** on the opt-in path: the external contract forbids dense vectors in agent-memory
recall below a measured threshold (>1000 entries *and* demonstrated lexical degradation). Neither has
been measured here.

**The bigger gap is the default path, and it is not this divergence.** A contract arbitrating
*between* retrieval methods does not cover the absence of one. Reading the whole store every turn
fails by arithmetic rather than by ranking quality, and nothing in the current design bounds it:
there is no cap, no snapshot, no TTL.

**Measured, 2026-08, against the published artefact.** 100 real stores on one developer machine, 687
entries, ~3.2 KB per entry. Feeding the largest — 66 entries, 275 KB on disk — to
`readFactsFromMarkdown` returns all 66 and **246K characters, roughly 66K tokens injected into every
turn's system prompt**, before the user has said anything. Nine more stores are already past the
point where the injection exceeds a session budget.

Two things make this worse than a size problem. The CLI's store is read **whether or not
`local.sessionDir` is set**, so a consumer who never opted into CLI interop still gets it. And the
cost is invisible: nothing errors, the window just fills, and the tokens are not attributed to
memory. An earlier version of this document said "at 64 entries it does not hurt" — that was an
assumption, and measuring it is what disproved it.

`metadata.modified` is already written (`markdown-store.ts:210`) and parsed (`:177`) and consumed by
nothing — the data for a staleness signal is on disk today, unused.

---

## Known gaps, recorded so they are not rediscovered

Each row says what would close it, not only that it is open — the two invite very different work.

| gap | where | what would close it |
|---|---|---|
| **The default recall path has no selection at all** — every fact enters the prompt each turn | `internal/local-agent/local-agent-send.ts:259` | A cap plus an ordering. Recency ordering with a fixed cap already bends the curve; the ranked pipeline can follow. **Measured:** a real 66-entry store injects ~246K characters (~66K tokens) per turn, and the CLI's store is read whether or not `local.sessionDir` is set. |
| No retention of any kind — no TTL, prune, or decay | searched `ttl\|prune\|expire\|retention` across both packages: zero | A per-kind TTL plus a prune step in the sweep. Needs the kind vocabulary to mean something first (§ 2), which is why this orders before widening it. |
| No quarantine — a first write is immediately recallable | searched `quarant\|corrobor\|confirmation_count`: zero | A confirmation counter in the frontmatter and a recall filter that skips entries below it. The single write path (`local-agent-runtime-extensions.ts:147`) makes this a one-place change. |
| `description` is written as a copy of the body | `markdown-store.ts:205-211` — the *reader* (`:174-177`) already handles a distinct description correctly | Stop writing one when nobody declared it. The role is a one-line recall aid; deriving it mechanically would be inferring the situation, which § 2's rule already forbids for `kind`. Absent is a valid state and the reader already falls back to the body. |
| The dream sweep never filters by kind before dedup | `dreaming/phases.ts:34` — `lightPhase` never reads `kind` | Partition by kind before `lightPhase`. Nothing is deleted today, but a consolidated note can blend two distinct entries, and the note is what search returns. |
| The dream sweep does not update the index | `dreaming/run.ts:53-96` writes `notes/` and never syncs | An `IndexManager.sync` after `writeConsolidatedNotes`. |
| Recall fires every turn, cached on query hash, not on store manifest | `internal/local-agent/local-agent-memory.ts:87`; `sdk-memory/internal/active-memory/active-memory-cache.ts:66` | A second skip condition beside the existing one — hash of the store manifest, so an unchanged store skips even when the question changes. The query cache is not wrong; it answers a different question. |
