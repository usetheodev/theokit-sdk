---
"@theokit/sdk-tools": patch
---

`git_status` with an injected sandbox now asks the backend whether there is a repository, instead of
probing the host.

A session whose checkout lives inside the backend got `{ ok: false, error: "not_a_repo" }` for a
repository that was perfectly present where the command would have run — while `git_diff`,
configured identically in the same session, worked. `not_a_repo` exists so the model cannot read "no
repository" as "nothing changed", so being wrong about it is worse than being unavailable.

The path-scope check also moves ahead of the probe: a traversal attempt in a confined session used
to be answered `not_a_repo` rather than `path_traversal`.
