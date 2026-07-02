---
slug: theokit-ecosystem
date: 2026-07-02
generated_by: roadmap-init
questions_answered: 3
unresolved_dims: [users_Q2, north_star_Q7, runtime_scope_Q5]
status: completed
note: >
  Socratic interview stopped early at user direction ("chega, escreve o roadmap" —
  reinforced by re-pasting the #54-#68 gap table on 2026-07-02). The 7 dimensions were
  SYNTHESIZED from existing context (cross-validation reports, locked 4-pillar narrative
  in the repo CLAUDE.md files, and 3 confirmed AskUserQuestion answers) rather than
  collected question-by-question. Unresolved dims are flagged in ROADMAP.md § Unresolved.
---

# Roadmap grill: theokit-ecosystem

## Confirmed scoping answers (via AskUserQuestion, 2026-07-02)

1. **Scope/location** = "Os dois (meta + link)" → ecosystem ROADMAP.md at `theokit-tools/ROADMAP.md`
   + a Harness-focused pointer roadmap in `theokit-sdk/ROADMAP.md`.
2. **Content** = "Fit + os 15 issues cross-val" → map ecosystem-fit across the 4 pillars AND thread
   the 15 cross-validation issues (#54–#68) as Harness-hardening milestones (M0–M3).
3. **Ritual** = "/roadmap-init completo" → run the official skill (later short-circuited to synthesis
   at user direction).

## Synthesized dimensions (from context, not interviewed)

- **Q1 root problem:** production agents force lock-in vs brittle glue; TheoKit = open coherent 4-pillar stack.
- **Q2 users (UNRESOLVED):** assumed external OSS adopters + internal Theo teams as primary — confirm before M4/M5.
- **Q3 in scope:** trustworthy Harness (15 gaps closed) + cross-pillar walking skeletons + coherent release.
- **Q4 out of scope:** live/bidi + artifacts (adk scope), cloud GA promises (PaaS pre-release), @theokit/di as Harness dep (ADR D431).
- **Q5 constraints (runtime scope UNRESOLVED):** TS/pnpm/Node≥22.12 locked; local primary, cloud opt-in/pre-release — M7 sequencing depends on external PaaS readiness.
- **Q6 ship criterion:** all crit+high #54–#68 closed TDD-first + ≥2 cross-pillar skeletons real-LLM-validated.
- **Q7 north-star (UNRESOLVED):** proposed "time-to-first-working-agent" — confirm before M8 baselines it.
