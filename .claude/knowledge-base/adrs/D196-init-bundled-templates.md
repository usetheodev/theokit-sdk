# D196 — `theokit init` templates are bundled, not git-cloned

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Templates ship as a `templates/<name>/` directory INSIDE the CLI package
tarball (declared via `"files": ["dist", "templates", ...]` in
package.json — EC-C MUST FIX). `theokit init` walks the bundled dir,
copies to `<dest>/`, substitutes `{{projectName}}` and `{{sdkVersion}}`.
No git clone, no `degit` dep, no network at scaffold time.

## Rationale

- **Air-gapped CI / firewalled enterprise** networks need scaffolding
  to work without network. `degit`-style git clone fails there.
- **Offline `npx`** — `npx --offline @theokit/cli init` works once the
  package is cached. Important for air-gap dev environments.
- **Atomic versioning** — templates ship with the CLI semver; no drift
  between "the CLI you have" and "the templates it produces."

Alternatives rejected:

- **`degit` clone from GitHub** — adds a dep, requires network, breaks
  air-gap. Marginal benefit (template updates without re-publishing).
- **Embed templates in `@theokit/sdk`** — wrong package; CLI is the
  scaffolder, not the library.

## Consequences

- Enables: offline scaffolding, atomic CLI+template versioning.
- Constrains: each new template inflates the published tarball
  (~20KB). 3 templates ship at v1 = ~60KB. Acceptable; we cap at ~5
  bundled templates before considering an opt-in remote registry.
