---
"@theokit/sdk-tools": patch
---

`edit_file` wrote its backup to `<path>.bak` with `copyFile`, and the project-root guard that
validates `path` never looked at that second path. An attacker who could place a file inside the
workspace ahead of the edit — which is the ordinary situation for an agent working on a repository
it did not write — could plant a symlink there and have the backup written through it, anywhere on
the filesystem the process could reach.

Reproduced before the fix: a symlink at `<path>.bak` pointing outside the project root received the
file's contents, and `edit_file` reported success.

The backup is now opened with `O_NOFOLLOW`, so the kernel refuses a symlink outright rather than a
check deciding it is safe and the write happening a moment later. An existing **regular** `.bak` is
still overwritten, so the documented behaviour is unchanged for every legitimate edit.

When the path is refused, the tool returns `{ ok: false, error: "unsafe_backup_path" }` and **does
not perform the edit**. An edit that silently proceeded without the backup the caller asked for
would be the quieter bug.
