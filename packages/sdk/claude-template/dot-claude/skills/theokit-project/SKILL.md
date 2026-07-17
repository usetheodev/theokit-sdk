---
user-invocable: false
paths:
  - "**/*project*"
  - "**/*Project*"
  - "**/THEO.md"
description: TheoKit SDK project-instruction reader/writer — hierarchical walk-up discovery + atomic write of THEO.md
---

# TheoKit Project Instructions

Hierarchical project-instruction reader/writer on `@theokit/sdk/project`. The
reader walks up from `cwd` collecting an instruction file (default `THEO.md`) and
NEVER throws; the writer writes it atomically and FAILS LOUD on error.

```ts
import {
  readProjectInstructions, writeProjectInstructions,
} from "@theokit/sdk/project";
import type {
  ProjectInstructions, ProjectInstructionFile, ProjectInstructionScope,
  ReadProjectInstructionsOptions, WriteProjectInstructionsOptions,
} from "@theokit/sdk/project";
```

## Read (walk-up, never throws)

Discovers every `<dir>/<filename>` from `cwd` up to the filesystem root (or
`stopDir`). Returns `files` nearest-first plus a `content` reduction chosen by
`scope` (`"nearest"` → innermost file; `"merged"` → all joined root-first).
No file found → `{ files: [], content: undefined }`.

```ts
const result: ProjectInstructions = await readProjectInstructions(process.cwd(), {
  filename: "THEO.md",   // default "THEO.md"
  scope: "merged",       // default "nearest"
  stopDir: "/home/me/repo",
});

if (result.content) applySystemPrompt(result.content);
for (const f of result.files) console.log(f.path, f.content.length);
```

## Write (atomic, fails loud)

Writes `<cwd>/<filename>` via temp + fsync + rename. An unsafe `filename`
(traversal, separators, absolute) is rejected with `ConfigurationError`
(`code: "unsafe_filename"`); a real write error (e.g. missing parent dir)
propagates — never silently swallowed.

```ts
await writeProjectInstructions(process.cwd(), "# Project rules\n…", {
  filename: "THEO.md",   // default "THEO.md"
});
```
