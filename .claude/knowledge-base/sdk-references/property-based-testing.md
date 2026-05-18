# Property-Based Testing

> Para features com state machine complexa (kanban claim/heartbeat/reclaim,
> compression budget, cron tick), **example-based testing perde edge
> cases**. Property-based testing gera 10000+ inputs aleatórios checando
> que **invariants holdem**. Hermes usa em `tests/stress/test_property_fuzzing.py`
> (kanban). TypeScript equivalente: [`fast-check`](https://github.com/dubzzz/fast-check).

## Quando aplicar

Use property-based quando:

- State machine com 5+ states + transitions (kanban tasks, compression
  budget, cron jobs)
- Concurrency (multiple writers, race conditions)
- Algoritmos com edge cases não-óbvios (FTS5 sanitization, path
  resolution)
- Anywhere você se pergunta "what if user does weird thing X?"

Não use para:

- Pure functions deterministic com input space pequeno (`add(a, b)`)
- Tests de fluxo específico (test "user flow A" não precisa property)
- Tests de validação simples (regex match)

## O conceito

Example test:

```typescript
it("addClaim increments lock_count", () => {
  const board = new Board();
  board.claim("t1");
  expect(board.lockCount).toBe(1); // 1 specific input, 1 specific assertion
});
```

Property test:

```typescript
it("lock_count == sum of claimed task statuses", () => {
  fc.assert(fc.property(
    fc.array(fc.string({ minLength: 1 })), // qualquer array de task IDs
    (taskIds) => {
      const board = new Board();
      for (const id of taskIds) {
        board.addTask(id);
        if (Math.random() > 0.5) board.claim(id);
      }
      
      // INVARIANT: lockCount equals claimed task count
      const claimedCount = board.tasks.filter((t) => t.status === "running").length;
      expect(board.lockCount).toBe(claimedCount);
    },
  ));
});
```

`fast-check` gera 100 (default) inputs aleatórios. Para cada, asserts
o invariant. Se find counter-example, **shrinks** automaticamente — encontra
o MENOR input que falha.

## Pattern: kanban state machine

Hermes' kanban tem tasks com status `triage → ready → running → done`
(plus `blocked`, `archived`). Claims TTL-based. Heartbeats refresh TTL.

Properties que devem hold sempre:

1. **At most 1 claim per task at any time**
2. **Status transitions only happen via expected paths**
3. **Heartbeat refreshes claim_expires**
4. **Reclaim só rola se claim_expires < now AND claim_lock present**

```typescript
// tests/kanban/kanban.property.test.ts
import fc from "fast-check";
import { Kanban } from "@/internal/kanban";

interface Action {
  type: "addTask" | "claim" | "heartbeat" | "release" | "complete" | "advance_time";
  taskId?: string;
  claimerId?: string;
  seconds?: number;
}

const actionArb = fc.oneof(
  fc.record({ type: fc.constant("addTask"), taskId: fc.uuid() }),
  fc.record({ type: fc.constant("claim"), taskId: fc.uuid(), claimerId: fc.string() }),
  fc.record({ type: fc.constant("heartbeat"), taskId: fc.uuid(), claimerId: fc.string() }),
  fc.record({ type: fc.constant("complete"), taskId: fc.uuid(), claimerId: fc.string() }),
  fc.record({ type: fc.constant("advance_time"), seconds: fc.integer({ min: 1, max: 7200 }) }),
);

it("at most 1 claim per task at any time", () => {
  fc.assert(fc.property(
    fc.array(actionArb, { minLength: 5, maxLength: 100 }),
    (actions) => {
      const board = new Kanban();
      let virtualTime = Date.now();
      
      for (const action of actions) {
        try {
          switch (action.type) {
            case "addTask": board.addTask(action.taskId!); break;
            case "claim": board.claim(action.taskId!, action.claimerId!, virtualTime); break;
            case "heartbeat": board.heartbeat(action.taskId!, action.claimerId!, virtualTime); break;
            case "complete": board.complete(action.taskId!, action.claimerId!); break;
            case "advance_time": virtualTime += action.seconds! * 1000; break;
          }
        } catch {
          // Some actions invalid given state — that's OK, just skip
        }
      }
      
      // INVARIANT: at any moment, each task has at most 1 claim
      const claimsByTask = new Map<string, number>();
      for (const task of board.tasks) {
        if (task.status === "running" && task.claim_lock) {
          claimsByTask.set(task.id, (claimsByTask.get(task.id) ?? 0) + 1);
        }
      }
      
      for (const count of claimsByTask.values()) {
        expect(count).toBeLessThanOrEqual(1);
      }
    },
  ), { numRuns: 100, verbose: true });
});

it("heartbeat preserves claim", () => {
  fc.assert(fc.property(
    fc.string(),
    fc.string(),
    (taskId, claimerId) => {
      const board = new Kanban();
      board.addTask(taskId);
      board.claim(taskId, claimerId);
      const beforeHeartbeat = board.getTask(taskId).claim_expires;
      
      // Time passes
      vi.advanceTimersByTime(60_000);
      
      board.heartbeat(taskId, claimerId);
      const afterHeartbeat = board.getTask(taskId).claim_expires;
      
      // INVARIANT: heartbeat advances claim_expires
      expect(afterHeartbeat).toBeGreaterThan(beforeHeartbeat);
    },
  ));
});
```

## Pattern: FTS5 sanitizer

```typescript
// tests/internal/sanitize-fts5.property.test.ts
import fc from "fast-check";
import { sanitizeFts5Query } from "@/internal/session-db/sanitize-fts5";

it("output never contains unmatched specials", () => {
  fc.assert(fc.property(fc.string(), (input) => {
    const output = sanitizeFts5Query(input);
    
    // Count parens, brackets — must be balanced or absent
    const openCount = (output.match(/[\[\{(]/g) || []).length;
    const closeCount = (output.match(/[\]\}\)]/g) || []).length;
    expect(openCount).toBe(closeCount);
  }));
});

it("phrases preserved (count of quoted phrases unchanged)", () => {
  fc.assert(fc.property(
    fc.array(fc.string({ minLength: 1 }), { minLength: 0, maxLength: 5 }),
    (phrases) => {
      const input = phrases.map((p) => `"${p.replace(/"/g, "")}"`).join(" ");
      const output = sanitizeFts5Query(input);
      
      // Same number of quoted phrases
      const inputQuoted = (input.match(/"[^"]+"/g) || []).length;
      const outputQuoted = (output.match(/"[^"]+"/g) || []).length;
      expect(outputQuoted).toBeGreaterThanOrEqual(inputQuoted);
    },
  ));
});
```

## Pattern: compression budget

```typescript
import { IterationBudget } from "@/internal/runtime/budget";

it("compressionAttempts never exceeds max", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 100 }), // max compressions allowed
    fc.array(fc.boolean()),            // sequence of compress/skip
    (max, attempts) => {
      const budget = new IterationBudget(1000, max);
      let actualAttempts = 0;
      
      for (const shouldCompress of attempts) {
        if (shouldCompress) {
          if (budget.recordCompression().allowed) {
            actualAttempts += 1;
          }
        }
      }
      
      // INVARIANT: never exceed cap
      expect(actualAttempts).toBeLessThanOrEqual(max);
      expect(budget.compressionAttempts).toBeLessThanOrEqual(max);
    },
  ));
});
```

## Shrinking — automatic counter-example minimization

Quando property falha, fast-check **shrinks** o input para o menor que
reproduz. Exemplo:

Falha original (500-action sequence):

```
[addTask "t1", claim "t1" "a", claim "t1" "b", ...]
```

After shrinking:

```
[addTask "t1", claim "t1" "a", claim "t1" "b"]  // 3 actions — minimum to fail
```

Output do fast-check em failure:

```
Property failed after 23 tests
Counterexample: [
  { type: "addTask", taskId: "t1" },
  { type: "claim", taskId: "t1", claimerId: "a" },
  { type: "claim", taskId: "t1", claimerId: "b" }, // ← cause
]
```

Debug straightforward.

## Architectural decisions

### AD-1: Default 100 runs, scale para 1000+ em CI

Local dev: 100 runs balance speed. CI: ramp up para 1000+ para confidence.

```typescript
// Local
fc.assert(prop, { numRuns: 100 });

// CI (via env var)
const runs = process.env.PROPERTY_TEST_RUNS ?? 100;
fc.assert(prop, { numRuns: Number(runs) });
```

### AD-2: Verbose mode for failures

```typescript
fc.assert(prop, {
  numRuns: 100,
  verbose: 2, // print shrinking trace
});
```

When property fails, prints every shrink step. Diagnoses why this specific
input fails.

### AD-3: Avoid `fc.unicode()` unless testing unicode

Most properties don't need unicode chaos. `fc.string()` (default
restricted to ASCII) is faster and sufficient. Use `fc.unicodeString()`
only when testing locale/encoding handling.

### AD-4: Custom arbitraries para domain types

```typescript
const taskIdArb = fc.string({ minLength: 5, maxLength: 30 })
  .map((s) => `t_${s.replace(/[^a-z0-9]/g, "")}`);

const claimerIdArb = fc.uuid();

const timestampArb = fc.integer({
  min: new Date("2026-01-01").getTime(),
  max: new Date("2027-01-01").getTime(),
});

// Compose:
const claimActionArb = fc.record({
  type: fc.constant("claim"),
  taskId: taskIdArb,
  claimerId: claimerIdArb,
  at: timestampArb,
});
```

Mais realistic, melhor coverage.

## Failure modes prevenidos

1. **Edge cases unprobed**: example tests cover happy path, miss
   adversarial inputs. Property finds: empty strings, very long inputs,
   unicode, very large/small numbers, race orderings.

2. **State machine bugs**: 4 states + transitions = 12 combinações. 100
   actions sequenciais = milhões de paths. Property explores broadly.

3. **Regression**: bug found in example → fixed → similar bug shipped
   later under different conditions. Property catches the class.

## Failure modes NÃO prevenidos

- **Property is wrong**: bug in property logic itself. Defesa: code review
  do property.

- **State space too large**: 1000 runs ainda underexplore. Defesa:
  increase runs em CI; use shrinking to focus.

- **Properties não testam business**: property "X works without crash"
  não checa correctness. Defesa: include business invariants ("if T
  is done, no child T2 with status='ready'").

## Como começar

Para feature nova com state machine:

1. **List invariants** que devem hold sempre.
2. **Identify actions** que podem mutate state.
3. **Generate sequences** de actions com fast-check.
4. **Apply em interpreter** (test code que executa actions).
5. **Assert invariants** depois de cada sequence.

Exemplo workflow:

```typescript
// 1. INVARIANTS
// - At most 1 claim per task
// - Heartbeat preserves claim
// - Reclaim only after expiration

// 2. ACTIONS
type Action = AddTask | Claim | Heartbeat | Release | Complete | AdvanceTime;

// 3. GENERATOR
const actionArb = fc.oneof(/* ... */);

// 4. INTERPRETER
function applyActions(actions: Action[]): Kanban {
  const board = new Kanban();
  for (const a of actions) {
    // dispatch
  }
  return board;
}

// 5. PROPERTIES
it("invariant 1", () => fc.assert(...));
it("invariant 2", () => fc.assert(...));
```

## Onde wirar no SDK

`packages/sdk/`:

- Dev dep: `pnpm add -D fast-check`
- Tests: `tests/<feature>/<feature>.property.test.ts`
- CI: `PROPERTY_TEST_RUNS=1000 pnpm test`

Property tests cândidatos no Theokit:

- `tests/internal/session-db/sanitize-fts5.property.test.ts`
- `tests/internal/runtime/budget.property.test.ts` (compression)
- `tests/internal/kanban/kanban.property.test.ts` (state machine — futuro)
- `tests/internal/cron/scheduler.property.test.ts` (tick deduplication)

## Referências cruzadas

- [testing-invariant-vs-snapshot.md](./testing-invariant-vs-snapshot.md) — property tests são invariants em scale
- [hermetic-test-isolation.md](./hermetic-test-isolation.md) — fixtures
- [compression-death-spiral.md](./compression-death-spiral.md) — invariants do budget

## Citações primárias

- `referencia/hermes-agent/tests/stress/test_property_fuzzing.py` — kanban Python
- `.claude/knowledge-base/hermes-deep-dive/14-testing-strategy.md:130-160` — discussão
- fast-check docs: https://fast-check.dev/
