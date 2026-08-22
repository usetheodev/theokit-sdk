---
"@theokit/sdk": patch
---

A test run can no longer write into the developer's real home directory.

The shared test setup gave every test an isolated `THEOKIT_HOME` in a fresh temporary directory, and
backed up `HOME` alongside it — but never actually set `HOME`. So any module reading `HOME` or
`os.homedir()` directly, instead of consulting `THEOKIT_HOME`, resolved to the real home and wrote
there. That was not hypothetical: the MCP token store did exactly this, and a real `~/.theokit`
credential file was observed accumulating test fixtures and changing timestamps across an afternoon
of runs.

That one module was fixed previously. This closes the gap itself, so the next module that reads the
home directory without going through `THEOKIT_HOME` cannot repeat it. Isolation is now enforced by
the setup rather than by each module remembering, which is the difference between a property and a
convention.

Verified the way the problem was originally found: the golden MCP suite was run with `HOME` pointed
at a throwaway sentinel directory, and nothing was written to it.

Also included: the dependency-boundary check now cruises the test tree as well as the source tree,
and the code-quality gate refuses to report success when it audited no languages at all — previously
a gate with nothing enabled returned a pass, which is indistinguishable from a clean run.
