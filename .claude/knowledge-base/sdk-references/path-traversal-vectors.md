# Path Traversal Vectors

> Path inputs do usuário (skill names, file paths, archive members,
> symlink targets) precisam ser **validated against escape**. Hermes
> shipou e fixou path-traversal em 7+ surfaces. Esse doc lista os
> vectors comuns + patterns de validação.

## Quando aplicar

Aplique em TODA path lookup onde:

- Input vem do usuário ou do LLM (skill names, file paths em tool calls)
- Path é JOINED com base directory (`join(theokit_home, userInput)`)
- Archive members são extraídos (tar/zip → filesystem)
- Symlinks podem ser dereferenced (file reads, write deny list)

Não aplique para:

- Paths absolutos do system (`/usr/bin/git` — controlled)
- Test fixtures em `os.tmpdir()` (already isolated)

## Por que importa

Path traversal = attacker controla path → escapa do diretório esperado
→ lê/escreve fora. Hermes shipou e fixou 7 vectors:

| Vector | PR | Versão |
|---|---|---|
| `skill_view` lendo `../../../etc/passwd` | #220 | v0.2 |
| Shell injection via sudo password piping | #65 | v0.2 |
| Multi-word prompt injection bypass | #192 | v0.2 |
| Cron prompt injection scanner bypass | #63 | v0.2 |
| Symlink boundary in `skills_guard` | #386 | v0.2 |
| Symlink bypass in write deny list | #61 | v0.2 |
| Self-update zip-slip | #3250 | v0.5 |
| Skill category names (`../`) | #3844 | v0.6 |
| Skill bundle paths | #3986 | v0.7 |
| Profile import tar zip-slip | #4318 | v0.7 |
| Cron prompt-injection scanner including skill content | #21350 | v0.13 |
| Browser cloud-metadata SSRF floor | #21228 | v0.13 |

7+ distinct vectors, fixed across 7 releases. Não é teórico.

## Vector 1: Path join com user input

```typescript
// VULNERABLE
function readSkill(name: string): string {
  const path = join(getTheokitHome(), "skills", name);
  return readFile(path, "utf-8"); // attacker: name = "../../../etc/passwd"
}

// DEFENSED
function readSkill(name: string): string {
  // 1. Sanitize: only alphanumeric + dashes
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(name)) {
    throw new ConfigurationError(`Invalid skill name: "${name}"`);
  }
  
  // 2. Construct path
  const base = join(getTheokitHome(), "skills");
  const path = join(base, name);
  
  // 3. Verify resolved path is INSIDE base
  const resolved = resolve(path);
  if (!resolved.startsWith(resolve(base) + sep)) {
    throw new SecurityError(`Path escape attempt: ${path}`);
  }
  
  return readFile(resolved, "utf-8");
}
```

Layer 1 (regex sanitization) catches obvious. Layer 3 (resolve + prefix
check) catches symlink + normalized escape. Both needed.

## Vector 2: Symlink traversal

Skill name passa sanitization, mas `~/.theokit/skills/innocent-name`
is a symlink pointing to `/etc/passwd`. Read follows symlink → escape.

```typescript
function readSkill(name: string): string {
  // ... regex sanitize ...
  const path = join(getTheokitHome(), "skills", name);
  
  // Check symlink BEFORE read
  const stat = lstatSync(path); // NOT statSync — lstat doesn't follow
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(path);
    const resolvedTarget = resolve(dirname(path), target);
    if (!resolvedTarget.startsWith(resolve(getTheokitHome()) + sep)) {
      throw new SecurityError(
        `Symlink escape: "${name}" → "${resolvedTarget}"`,
      );
    }
  }
  
  return readFile(path, "utf-8");
}
```

Hermes' `skills_guard` (`tools/skills_guard.py`) implements this pattern
(v0.2 #386 + #61 fixes).

## Vector 3: Zip-slip / tar-slip

Archive extraction can write outside extraction directory:

```typescript
// VULNERABLE: blindly extract
import * as tar from "tar";

await tar.extract({
  file: "archive.tar",
  cwd: join(getTheokitHome(), "import-temp"),
}); // tar member with "../../../etc/cron.d/evil" writes outside cwd

// DEFENSED: validate member paths first
async function safeExtract(archive: string, cwd: string): Promise<void> {
  const cwdResolved = resolve(cwd);
  const list: string[] = [];
  
  // Pass 1: list members + validate paths
  await tar.list({
    file: archive,
    onentry: (entry) => {
      const memberPath = resolve(cwd, entry.path);
      if (!memberPath.startsWith(cwdResolved + sep)) {
        throw new SecurityError(
          `tar-slip detected: "${entry.path}" → "${memberPath}"`,
        );
      }
      list.push(entry.path);
    },
  });
  
  // Pass 2: extract (validated)
  await tar.extract({ file: archive, cwd });
}
```

Hermes' profile import (`hermes_cli/profile.py`) validates archive
members against zip-slip (v0.7 #4318).

## Vector 4: Symlinks dentro de archive

Archive contains symlink whose target escapes cwd:

```
my-archive.tar:
  ├── innocent-file.txt
  └── evil-link  →  /etc/passwd
```

Extract → file system gets symlink → next read follows → escape.

```typescript
async function safeExtract(archive: string, cwd: string): Promise<void> {
  await tar.list({
    file: archive,
    onentry: (entry) => {
      // Validate path
      // ...
      
      // ADDITIONAL: reject symlinks entirely (or validate target)
      if (entry.type === "SymbolicLink" || entry.type === "Link") {
        const linkTarget = entry.linkpath;
        const resolved = resolve(cwd, dirname(entry.path), linkTarget);
        if (!resolved.startsWith(resolve(cwd) + sep)) {
          throw new SecurityError(
            `Symlink in archive escapes: "${entry.path}" → "${linkTarget}"`,
          );
        }
      }
    },
  });
  // ...
}
```

Easier alternative: **reject all symlinks** during extraction. Skill
bundles and profile exports don't legitimately need symlinks.

## Vector 5: Prompt injection via path

Some inputs path-like enter prompts. LLM may follow them:

```
USER input: "search for: ../../../etc/passwd"
→ Agent constructs query, passes to search tool
→ Search tool might log the query
→ Log might be re-injected to model later
→ Loop
```

Defesa: sanitize at boundary. Anything LLM-touched should NOT be a path
without sanitization layer.

## Vector 6: Resolve before validate

Bug pattern:

```typescript
// WRONG: check before resolve
function readFile_BAD(name: string) {
  if (name.includes("..")) throw new Error("nope");
  const resolved = resolve(getTheokitHome(), name);
  return readFile(resolved); // attacker: "foo/.\\./bar" passes the check, but resolves differently
}

// RIGHT: resolve THEN validate
function readFile_GOOD(name: string) {
  const resolved = resolve(getTheokitHome(), name);
  const base = resolve(getTheokitHome());
  if (!resolved.startsWith(base + sep)) throw new SecurityError(...);
  return readFile(resolved);
}
```

Sempre resolve PRIMEIRO, then check prefix.

## Pattern canonical (TS)

```typescript
// packages/sdk/src/internal/security/path-guard.ts
import { resolve, sep } from "node:path";
import { lstatSync, readlinkSync } from "node:fs";

export class PathTraversalError extends Error {
  constructor(public input: string, public resolvedPath: string) {
    super(`Path traversal attempt: "${input}" → "${resolvedPath}"`);
    this.name = "PathTraversalError";
  }
}

/**
 * Validates that resolved(base + input) stays under base.
 * Returns the safe absolute path on success.
 */
export function safePathJoin(base: string, ...parts: string[]): string {
  const baseResolved = resolve(base);
  const target = resolve(base, ...parts);
  
  if (target !== baseResolved && !target.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(parts.join("/"), target);
  }
  
  return target;
}

/**
 * Validates that a symlink target stays under base (or is not a symlink).
 */
export function assertNoSymlinkEscape(path: string, base: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return; // path doesn't exist — no escape risk
  }
  
  if (!stat.isSymbolicLink()) return;
  
  const target = readlinkSync(path);
  const resolvedTarget = resolve(path, "..", target);
  const baseResolved = resolve(base);
  
  if (!resolvedTarget.startsWith(baseResolved + sep)) {
    throw new PathTraversalError(`symlink ${path}`, resolvedTarget);
  }
}

/**
 * Sanitize an identifier (skill name, agent ID, etc.) to safe path component.
 */
export function sanitizeIdentifier(input: string, maxLen: number = 64): string {
  if (input.length === 0 || input.length > maxLen) {
    throw new ConfigurationError(`Invalid identifier length`);
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(input)) {
    throw new ConfigurationError(`Identifier contains invalid characters: "${input}"`);
  }
  return input.toLowerCase();
}
```

## Failure modes prevenidos

1. **Skill name `../../../etc/passwd`**: `sanitizeIdentifier` rejeita
   via regex. `safePathJoin` rejeita se passa de algum modo.

2. **Symlink in skill dir pointing outside**: `assertNoSymlinkEscape`
   catches.

3. **Tar archive escaping cwd**: `safeExtract` validates member paths.

4. **Tar with symlink to /etc/passwd**: extra check rejects symlinks
   in archives.

5. **Normalized path bypass**: `resolve` BEFORE prefix check defeats
   `foo/.\\./bar` tricks.

## Failure modes NÃO prevenidos

- **Race condition (TOCTOU)**: check passes, then file gets replaced by
  symlink before read. See [toctou-race-prevention.md](./toctou-race-prevention.md).

- **Filesystem-level bypass**: `dev/fd/0`, `/proc/self/cwd`, similar
  magic paths. Defesa: explicit blocklist em sandbox layer.

- **Logical escape sem path**: app loaded plugin with arbitrary code
  exec. Defesa: plugin manifest validation; never `eval`.

## Como testar

```typescript
it("rejects absolute traversal", () => {
  expect(() => safePathJoin("/base", "../etc/passwd")).toThrow(PathTraversalError);
});

it("rejects normalized traversal", () => {
  expect(() => safePathJoin("/base", "subdir/..", "..", "etc")).toThrow(PathTraversalError);
});

it("accepts valid nested path", () => {
  const safe = safePathJoin("/base", "sub", "file.txt");
  expect(safe).toBe(resolve("/base", "sub", "file.txt"));
});

it("rejects symlink escape", () => {
  // Setup: /tmp/test-base/inner is symlink to /etc
  // Use real filesystem fixture
  expect(() => assertNoSymlinkEscape(symlinkPath, "/tmp/test-base"))
    .toThrow(PathTraversalError);
});

it("sanitizeIdentifier rejects path separators", () => {
  expect(() => sanitizeIdentifier("foo/bar")).toThrow(/invalid characters/);
  expect(() => sanitizeIdentifier("..")).toThrow(/invalid characters/);
  expect(() => sanitizeIdentifier("good-name")).not.toThrow();
});

it("safeExtract refuses tar-slip member", async () => {
  // Mock tar archive with "../escape.txt" member
  await expect(safeExtract(maliciousArchive, "/tmp/dest"))
    .rejects.toThrow(/tar-slip/);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/security/`:

- `path-guard.ts` — `safePathJoin`, `assertNoSymlinkEscape`, `sanitizeIdentifier`
- Callers: anywhere user input becomes a path

Audit:

```bash
grep -rn "join.*getTheokitHome\|resolve.*\$THEOKIT_HOME" packages/sdk/src/
```

Each result → audit: input chega de user? Then wrap em safePathJoin.

## Referências cruzadas

- [profile-isolation.md](./profile-isolation.md) — all paths derive from `getTheokitHome()`
- [toctou-race-prevention.md](./toctou-race-prevention.md) — race conditions between check + use
- [secret-redaction-discipline.md](./secret-redaction-discipline.md) — error messages may need redaction

## Citações primárias

- v0.2 #220, #65, #192, #63, #386, #61 — early vector closures
- v0.5 #3250 — self-update zip-slip
- v0.7 #4318 — profile import tar zip-slip
- v0.13 #21228 — browser cloud-metadata SSRF
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:231-258` — failure mode list
