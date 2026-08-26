---
"@theokit/sdk": patch
---

Agent files written for the Claude Code CLI now load.

Two defects, both measured against the 64 agent-directory files on one machine (a project
`.claude/agents` plus every installed plugin):

- **`color` made the file a load error.** It appeared in 38 of the 59 agent declarations — it is the
  CLI's label colour and changes nothing about what an agent may do, but the loader rejects unknown
  frontmatter fields, so a majority of real agent files could not be loaded at all.
- **One README stopped every agent in the directory.** A markdown file with no frontmatter threw
  `subagent_missing_frontmatter`, aborting the whole directory read. `.claude/agents/README.md` is a
  real file in this repository, cited by its own cycle rules.

The strict-field check is NOT loosened — its reason is sound, and stated where it lives: a dropped
`sandbox` that an operator wrote believing it confines the child is a silent gate. Fields known to be
inert for this runtime are now named explicitly, which is the difference between "we know this one
and it does nothing" and "we have never heard of this". A field that could change behaviour still
fails loudly, and a file that HAS frontmatter and gets it wrong is still a broken agent. Only the
no-frontmatter case is skipped, with a warn naming the file.

Measured after: 64 files in, 59 agents loaded, 5 documentation files skipped. Before: zero.
