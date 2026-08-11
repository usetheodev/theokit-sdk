---
"@theokit/sdk": patch
---

**Security.** Fix a containment check that admitted a sibling directory and any symlink.

`.theokit/context/*.md` frontmatter carries a `path:`, so the value is repository-controlled —
untrusted whenever the repository came from somewhere else. `loadSources` guarded it with
`absolute.startsWith(resolvePath(cwd))`, which fails twice:

- **No separator boundary.** With `cwd = /home/user/proj`, the value `../proj-evil/secret.md`
  resolves to `/home/user/proj-evil/secret.md`, which starts with `/home/user/proj`. A sibling
  directory whose name merely extends the project's is admitted; no traversal past the parent is
  needed.
- **Lexical, not real.** A symlink whose name sits inside the root and whose target does not passes
  any comparison made before symlink resolution.

Measured against the pre-fix code: the file outside the root was READ and its content reached the
context snapshot. The obvious escapes (`../../etc/passwd`, an absolute path) were refused, and
refusing them is what made the check look correct in review.

The correct rule already existed in the package as a private function in the import resolver, written
for the 4.41.1 patch. It now lives in `path-containment.ts` and both readers of repository-supplied
paths share it — one rule, one representation, so the two cannot drift apart again.

**A second, independent defect fixed alongside it.** `refresh()` carried every legacy source into the
aggregator without filtering, and then stamped `"included"` on everything the budget kept — so the
containment verdict was computed and discarded three statements later, and `snapshot()` reported an
excluded source as included. Nothing leaked through that path (the content was empty), but a consumer
auditing "what is in my context" got the wrong answer.
