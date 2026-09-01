# `src/internal/` — subsystem entry points

## Which subsystems expose a barrel, and what that means

Seven of the ~25 subsystems here have an `index.ts`: `cloud-agent`, `local-agent`, `persistence`,
`plugins`, `providers`, `security`, `session`. The rest are entered by direct path.

**That split is documented rather than resolved, and the reason is measured.** An audit recommended
adopting one rule — every subsystem exposes `index.ts`, and cross-subsystem imports go through it,
enforced by dependency-cruiser — on the grounds that deep-path imports are what let two folders reach
into each other's internals. Fifteen mutually-dependent folder pairs were confirmed by measurement.
Applying the rule was then measured too, and it does not hold:

- **129 imports currently bypass an existing barrel** (57 into `persistence`, 22 each into
  `providers` and `plugins`, 20 into `security`, 6 into `session`, 2 into `local-agent`).
- **Routing them through the barrel would create file-level cycles.** `internal/local-agent/index.ts`
  transitively reaches `internal/runtime/lifecycle/` and `internal/session/`, and both of those import
  into `local-agent`. Today `madge --circular` reports **zero** cycles in `src/`; making the barrel the
  entry point would introduce them.
- **Five of the fifteen pairs are parent↔child** (`memory` ↔ `memory/storage`, `providers` ↔
  `providers/builtin`, `telemetry` ↔ `telemetry/adapters`, `system-prompt` ↔ `system-prompt/sources`,
  `subscription` ↔ `subscription/internal`). A barrel does not address those; a parent importing its
  child and the child importing the parent's types is ordinary.

A barrel is a module that depends on its entire subsystem. Routing a cross-subsystem import through
one **widens** the dependency surface — which is the opposite of the intent.

## What is enforced instead

`tests/architecture/no-cycles-at-all.test.ts` asserts the whole graph is acyclic. That is the property
the barrel proposal was reaching for, stated directly. It did not exist before: three sibling files
each pinned ONE historical cycle, so a new cycle anywhere else passed every architecture test.

## When to add a barrel

When a subsystem has a genuine public face that its consumers should hold instead of its internals —
`security` is the example, and its consumers all import downward into it. Not as a blanket rule, and
not for a subsystem whose consumers it imports back.
