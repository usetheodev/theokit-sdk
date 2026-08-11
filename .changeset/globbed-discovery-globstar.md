---
"@theokit/sdk": minor
---

`globbed` discovery now understands `**`.

A spec whose pattern contains a globstar finds files at every depth — `.theokit/rules/**/*.md`
returns `rules/top.md` as well as `rules/deep/nested/inner.md`. Patterns with a single `*` keep
their flat meaning, and no default spec changed: the capability is new, the behaviour of every
existing consumer is not.

The previous implementation split the pattern at its last `/`, treated the prefix as a literal
directory and read it once — documented as "nested directories deferred to v2". The deferral was
deliberate; what turned it into a defect was measured from a consumer. A product whose own rule
loader descends recursively could not migrate onto the `theokit-rules` spec without silently
dropping every nested rule, on the path that decides whether a repository's hooks execute. Worse,
writing `**` explicitly matched NOTHING — the directory part resolved to a literal `**`, so the
pattern lost even the top-level file it used to find.

Implemented with `fs.promises.glob` rather than a hand-written walker. It provides exactly these
semantics, verified against a fixture before adoption, and the package already requires Node
>= 22.12. Writing a walker would have been a third matcher inside one package — the duplication
that let the enumerator and `context-glob.ts` disagree in the first place.
