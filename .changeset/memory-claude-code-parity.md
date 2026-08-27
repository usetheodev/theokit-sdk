---
"@theokit/sdk": minor
---

Memory files now match the Claude Code layout, and a memory is named after its subject.

**What changes on disk.** A memory used to be named after its whole text, cut at 64
characters; it is now named after its topic (~32 characters), the index header is
`# Memory Index`, and each index line reads `- [Title](slug.md) — summary`. Stores written
by earlier versions are still read; only new writes land under the new names.

**Why it matters beyond tidiness.** Naming a memory after its whole text put the entry's
content into its filename, and a filename is the most exposed field an entry has — it shows
in directory listings, shell completion, tool logs and stack traces, none of which require
opening the file. This closes that (#446) by construction rather than by detection: a rule
about sensitive values would have to recognise one, and secret-pattern redaction cannot
recognise an arbitrary passphrase. Naming a memory after its subject drops the tail of the
sentence whatever the tail happens to be.

**The trade this makes, stated because it is real.** A topic name is a lossy summary, and
lossy summaries collide — three different facts about the same subject would reduce to one
filename. Writes with different text now move aside to `topic-2` instead of overwriting, so
nothing is lost; re-recording the same text still lands on the same file and increments its
corroboration count.

`MemoryFact` accepts optional `title` and `description` for callers that want to author them
rather than have them derived.

**Not fixed by this release, and measured:** an uncorroborated entry marked `[unconfirmed]`
influences the model without constraining it (~62%, 95% CI [39%, 82%], n=32), and a planted
entry phrased as standing policy was sufficient for a live agent to perform the action it
described in 2 of 6 runs. Registering the permission engine blocked the executive case in
every run; it is opt-in. Any deployment whose memory directory is writable by anything other
than the agent's own deliberate writes should register it.
