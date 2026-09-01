---
"@theokit/sdk": minor
---

`sanitizeToolInput` now reaches values inside arrays.

It never did. `{ tag: "  a  " }` came back trimmed and `{ tags: ["  a  "] }` came back untouched, with
nothing in the type or the documentation distinguishing them — the `@public` docblock on `deep` said
"recurse into nested objects/arrays", and array elements were not reached by any rung, including
`trim`, which is on by default.

Elements follow the same rules as fields: a string element is sanitized by whichever rungs are on, an
object element is descended only under `deep`. Array descent itself is not gated by `deep`, because a
value does not stop being a string by sitting in a list; `maxDepth` counts every hop and is what
bounds it. Arrays stay arrays.

If you were relying on array contents passing through a sanitizer untouched, they no longer do.
