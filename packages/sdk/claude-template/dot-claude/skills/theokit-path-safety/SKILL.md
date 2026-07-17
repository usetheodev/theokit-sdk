---
user-invocable: false
description: Path-traversal, symlink-escape, and forbidden-path guards from @theokit/sdk/path-safety for agent file I/O.
paths:
  - "**/*path-safety*"
  - "**/*pathsafety*"
---

# TheoKit SDK -- Path Safety

TOCTOU-safe path primitives to wire wherever user input becomes a filesystem path in a custom tool. `safePathJoin` resolves then prefix-checks; `assertNoSymlinkEscape` resolves the whole symlink chain via `realpathSync`; `isForbiddenPath` blocks sensitive files even when they are lexically inside the project.

## Import

```typescript
import {
  safePathJoin,
  assertNoSymlinkEscape,
  isForbiddenPath,
  safeFilenameForId,
  sanitizeIdentifier,
  PathTraversalError,
  ForbiddenPathError,
} from "@theokit/sdk/path-safety";
```

## Signatures

```typescript
function safePathJoin(base: string, ...parts: string[]): string;   // throws PathTraversalError on escape
function assertNoSymlinkEscape(path: string, base: string): void;  // throws PathTraversalError on symlink escape
function isForbiddenPath(input: string): boolean;                  // true for .env*, .git/, node_modules/, .theo/, lock files
function safeFilenameForId(id: string, options?: { maxLen?: number }): string; // total: passthrough or h-<16hex>
function sanitizeIdentifier(input: string, options?: { maxLen?: number }): string; // grammar ^[a-z0-9][a-z0-9-_]*$

class PathTraversalError extends ConfigurationError { constructor(input: string, resolvedPath: string); } // code "path_traversal"
class ForbiddenPathError extends ConfigurationError { constructor(path: string); }                         // code "forbidden_path"
```

## Guard a tool's file read

```typescript
const projectRoot = process.cwd();

function resolveUserPath(userPath: string): string {
  if (isForbiddenPath(userPath)) throw new ForbiddenPathError(userPath);
  const safe = safePathJoin(projectRoot, userPath); // throws PathTraversalError on "../" escape
  assertNoSymlinkEscape(safe, projectRoot);          // throws PathTraversalError on symlink escape
  return safe;
}
```

## Derive a safe filename from an opaque id

`safeFilenameForId` never throws on a non-empty string: it returns the id verbatim when it already matches the safe grammar, otherwise a deterministic `h-<16 hex>` sha256 token.

```typescript
safeFilenameForId("550e8400-e29b-41d4-a716-446655440000"); // passthrough
safeFilenameForId("user@example.com");                       // "h-<16hex>"
```
