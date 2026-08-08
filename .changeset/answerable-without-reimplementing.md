---
'@theokit/sdk': minor
---

Three facts the SDK already knew are now answerable, instead of being re-derived by every consumer.

- `assertSecureModes(dir, file)` — the 0700-dir / 0600-file gate, exported from `@theokit/sdk/auth`.
  Its own docstring names the attack it prevents (a writable directory lets someone swap the
  credential file for a symlink to their own), and that reasoning is not specific to this SDK's
  credential file: consumers keep sensitive stores beside it and were reading them with no check at
  all, because the gate was private.

- `writableRootsFor(mode, cwd)` — what a sandbox mode may write to, answerable WITHOUT spawning.
  `buildBwrapArgv` knew it, but only while building an argv, and consumers need the answer earlier:
  tools are scoped at agent construction, before any process exists. `[]` means nothing is writable;
  `null` means unrestricted — not `["/"]`, because unrestricted is the absence of a root rather than
  a root that happens to be `/`.

- `atomicWriteTempTarget(name)` — the file a leftover `<file>.<pid>.<hex>.tmp` was replacing.
  `replaceFileAtomic` creates those and has no opinion about sweeping them, so a consumer wanting to
  had to know a format that lived only in the implementation. Deliberately strict about pid digits
  and a 16-char hex suffix: matching any `.tmp` would claim other tools' scratch on a path whose
  purpose is deleting files.

Each is derived from the same helper its writer uses, so the answer and the behaviour cannot drift
apart. All three were measured from a consumer that had reimplemented them — one of them by copying
a regex out of a compiled chunk.
