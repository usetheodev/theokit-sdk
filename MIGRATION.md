# Migration guide

## SDK 2.0 — `@theokit/sdk` → `@theokit/sdk-core`

Upgrading from `@theokit/sdk@1.x` to `@theokit/sdk-core@2.x` is a
mechanical rename + a peer version bump. The runtime behavior of
the public `Memory` class, `migrateSqliteToLance`, agent loop, and
every other public surface is unchanged.

### TL;DR

```bash
# Automated migration (recommended)
npx @theokit/codemod-sdk-2-0 --write --backup

# Manual version bump if you pinned ^1.x
$EDITOR package.json   # change "@theokit/sdk-core": ">=1.7.0" → "^2.0.0"

# Reinstall + test
pnpm install
pnpm test

# Clean up
find . -name "*.bak" -delete
git add -A
git commit -m "migrate to @theokit/sdk-core (SDK 2.0)"
```

### What changed

#### Package rename

The npm package `@theokit/sdk` was renamed to `@theokit/sdk-core`
at the 2.0 major. Consumers update import specifiers + package.json
dep keys.

#### Memory subsystem extracted

The `internal/memory/*` subsystem (38 source files) was extracted
into a separate package: `@theokit/sdk-memory`. sdk-core's public
`Memory` class continues to work via runtime routing:

- When `@theokit/sdk-memory` is installed: sdk-core delegates to it.
- When sdk-memory is absent: sdk-core falls back to the internal copy
  (v1.x behavior preserved).

You don't need to install `@theokit/sdk-memory` to use `Memory`. You
DO need to install it if you want the standalone memory APIs
(e.g. `createInMemoryMarkdownProvider`).

See `docs/adr/0002-sdk-memory-optional-peer-routing.md` for the full
architectural rationale.

#### Subsystems already extracted in prior versions

The following were extracted in earlier releases and are NOT part of
the 2.0 migration:

- `@theokit/sdk-budget` (extracted in 1.x)
- `@theokit/sdk-cache` (extracted in 1.x)
- `@theokit/sdk-handoff` (extracted in 1.x)
- `@theokit/sdk-tools` (extracted in 1.x)

If you already use any of these, no change needed.

### What did NOT change

- Public API surface of `Memory.openIndex`, `Memory.runDreamingSweep`,
  `migrateSqliteToLance`, `Agent.create`, `Agent.prompt`, etc.
- Error messages — error text shapes preserved across the routing.
- Embedding adapter contract — `openai`, `mistral`, `openrouter`,
  `voyage`, `deepinfra`, `ollama` all available + behave identically.
- ADR catalog rules (ADR D11 + D183).
- TypeScript types — public surface dts shape preserved.

### Step-by-step

#### Step 1 — Commit your current work

```bash
git status   # should be clean OR all changes committed
```

#### Step 2 — Run the codemod in dry-run mode first

```bash
npx @theokit/codemod-sdk-2-0
```

Inspect the report. It lists every file that would be modified:

- `package.json` files (your project's + workspace deps if monorepo)
- `*.ts`, `*.tsx`, `*.mts`, `*.cts`, `*.js`, `*.mjs`, `*.cjs`
  source files with bare `@theokit/sdk` import specifiers
- `*.md` documentation references

If the report includes files you don't want touched, use `--root` to
narrow the scope:

```bash
npx @theokit/codemod-sdk-2-0 --root packages/my-package
```

#### Step 3 — Apply the codemod

```bash
npx @theokit/codemod-sdk-2-0 --write --backup
```

`--backup` creates `.bak` files next to every modified file. Keep
them until your test suite passes — they're your safety net.

#### Step 4 — Bump the peer version constraint manually if needed

The codemod preserves your existing version constraint. If you pinned
sdk to a `1.x` range, you need to bump it manually:

```diff
 "peerDependencies": {
-  "@theokit/sdk-core": ">=1.7.0"
+  "@theokit/sdk-core": "^2.0.0"
 }
```

Workspace pins (`workspace:*`, `workspace:^`, `file:...`) don't need
this — they resolve to whatever version is installed locally.

#### Step 5 — Reinstall + test

```bash
pnpm install   # or npm install / yarn install
pnpm test
```

If any test fails, the codemod might have missed a file. Inspect
the failure + the `.bak` files; report bugs to the SDK repo.

#### Step 6 — Clean up

```bash
find . -name "*.bak" -delete
git add -A
git commit -m "migrate to @theokit/sdk-core (SDK 2.0)"
```

### Rollback

If anything goes wrong after `--write`, restore from `.bak`:

```bash
find . -name "*.bak" -exec sh -c 'mv "$1" "${1%.bak}"' _ {} \;
pnpm install
```

This reverses every change the codemod made, leaving your working
tree exactly as it was pre-migration.

### Import shapes the codemod handles

Every realistic import shape is covered. The codemod uses a regex
specifier rewrite — sub-package names (`@theokit/sdk-memory`,
`-budget`, `-cache`, `-handoff`, `-tools`) are NEVER touched.

| Shape | Before | After |
|---|---|---|
| Bare specifier | `from "@theokit/sdk"` | `from "@theokit/sdk-core"` |
| Sub-path | `from "@theokit/sdk/agent"` | `from "@theokit/sdk-core/agent"` |
| Single-quoted | `from '@theokit/sdk'` | `from '@theokit/sdk-core'` |
| Type-only | `import type { X } from "@theokit/sdk"` | `import type { X } from "@theokit/sdk-core"` |
| Namespace | `import * as Theo from "@theokit/sdk"` | `import * as Theo from "@theokit/sdk-core"` |
| Re-export | `export { X } from "@theokit/sdk"` | `export { X } from "@theokit/sdk-core"` |
| Dynamic | `await import("@theokit/sdk")` | `await import("@theokit/sdk-core")` |

In `package.json`: `dependencies`, `devDependencies`,
`peerDependencies`, `optionalDependencies`, AND `peerDependenciesMeta`
keys are all rewritten. The version constraint value is preserved
verbatim (see Step 4 above for when to bump it manually).

The canonical contract is pinned by
`packages/codemod-sdk-2-0/tests/codemod.test.mjs` scenario
`testEdgeCaseImportShapes` — every row in the table above appears as
an assertion there.

### Known edge cases

- **Templating placeholders**: if your project uses templates like
  `"@theokit/sdk": "^{{sdkVersion}}"` in package.json, the codemod
  preserves the placeholder. Update the placeholder system to
  emit `@theokit/sdk-core` instead.

- **Documentation snippets**: `.md` files with code blocks
  containing `@theokit/sdk` are rewritten as well. Verify your
  release notes / blog posts still make sense post-migration.

- **Tests that grep for `@theokit/sdk`**: rewritten to
  `@theokit/sdk-core`. Validate the assertion still makes sense
  (e.g., a test asserting "package name is X" needs to be aware
  of the new name).

### Need help

- Public ADR: `docs/adr/0002-sdk-memory-optional-peer-routing.md`
- Operator runbook (for monorepo maintainers): `docs/runbook/sdk-2-0-release.md`
- Issue tracker: GitHub issues on the SDK repo.

## Earlier versions

Migration guides for pre-2.0 versions live in `docs/migration/`.
