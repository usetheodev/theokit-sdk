---
"@theokit/sdk": patch
---

Hooks imported from `.claude/settings.json` now run with `$CLAUDE_PROJECT_DIR` defined, so a
repository that also uses Claude Code stops denying every turn.

Reading that file is a deliberate compatibility decision, but the commands inside it are written for
Claude Code's runtime, which defines that variable and whose documentation tells hook authors to
reach project files through it. This SDK did not define it, so `sh` expanded it to the empty string
and `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh"` ran as `bash "/.claude/hooks/guard.sh"` — a
file that does not exist, which a hook runner correctly reads as a refusal. The result was every
tool call denied, in any repository whose only unusual property was having Claude Code set up, with
a message naming a script that was present and executable all along.

A denial caused by an undefined variable now names the variable. `$CLAUDE_PLUGIN_ROOT` and the rest
of that runtime's surface are still not supplied — inventing a value would send a script somewhere
real and wrong — but a hook that needs one fails saying which, instead of reporting a path that
failed ten characters later.
