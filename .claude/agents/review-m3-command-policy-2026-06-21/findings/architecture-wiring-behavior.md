# architecture + wiring + behavior — m3-command-policy
Verdict: 0 BLOCKER, 0 HIGH (1 LOW, INFO). biome clean (40 LoC), knip exit 0.
- INFO: SRP/cohesion/placement clean; DIP imports only catastrophicShellReason (same package), no @theokit/sdk or acp coupling.
- INFO [KEY]: Rule 9 COMPOSE-not-duplicate satisfied — denyCatastrophicCommands() CALLS catastrophicShellReason (no deny-list re-impl); the toBe test pins identity.
- INFO: deny-wins correct (first non-null, stops); empty→null (allows all); isCommandAllowed === (denial===null); no throw path.
- LOW → FIXED: empty-string policy return is a deny-with-blank-reason (undocumented/untested footgun). Documented on CommandPolicy + added a test pinning it.
- INFO: KISS no-new-package + pure-predicate (not a shipped ACP plugin) is the right call.
