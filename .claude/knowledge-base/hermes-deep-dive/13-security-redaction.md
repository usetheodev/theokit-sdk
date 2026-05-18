# 13 — Security & Secret Redaction (Cross-Cutting)

> Hermes' secret redaction lives in `agent/redact.py` (403 LoC). Regex
> patterns match known API key prefixes (OpenAI `sk-…`, GitHub `ghp_…`,
> Anthropic `sk-ant-…`, AWS `AKIA…`, Stripe, Slack `xox*-`, etc.) plus
> sensitive query/body parameter names (`access_token`, `password`,
> `signature`). Short tokens (<18 chars) fully masked; longer ones keep
> first 6 + last 4 chars for debuggability. `HERMES_REDACT_SECRETS=true`
> by default (per v0.13 PR #21193, reversing v0.12's off-default which
> had corrupted patches). Bridged from `security.redact_secrets` config
> via `hermes_cli/main.py`. Opt-out logs an operator warning. Plus 13
> P0/P1 security closures in v0.13 alone — Discord role-allowlist
> guild-scoping, WhatsApp stranger-rejection, TOCTOU windows, browser
> SSRF, cron prompt-injection. In TypeScript: `Security.redact(text)`
> with the same prefix list, plus an `enableRedaction()` opt-out.

## What problem this domain solves

The agent reads files, runs commands, captures stdout. That output flows into:

- Tool result strings sent back to the model (and so into the API provider's logs)
- `~/.hermes/logs/agent.log` and `errors.log`
- Gateway message history (sometimes shipped to remote logging)
- `hermes debug share` paste artifacts (uploaded publicly)
- Checkpoint commits (the file content gets snapshotted into git)

Any of these can leak credentials. An `env | grep API` in the terminal tool prints API keys; the model gets them; the API provider's logs get them; CloudWatch / Datadog get them; if the user runs `hermes debug share` for support, paste.rs gets them.

Redaction is the universal mitigation: regex-match known credential shapes *at every output boundary* and mask before they hit any of the above sinks. The discipline isn't "scrub once and forget"; it's "scrub at every layer."

The hard tradeoff is **false positives** vs **false negatives**. A too-aggressive regex corrupts legitimate content (the v0.12 redaction-off-by-default decision came after the patch tool mangled file content by mistaking valid code for `sk-…` prefixes). A too-loose regex misses real secrets. The v0.13 default-on with `code_file` opt-out for ENV/JSON files threads the needle.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `agent/redact.py` | 403 | Pattern definitions, redaction function, env var enable check. |
| `tests/agent/test_redact.py` | — | Pattern coverage tests. |
| `tests/cli/test_cli_secret_capture.py` | — | CLI secret leak tests. |
| `tests/tools/test_browser_secret_exfil.py` | — | Browser URL/response secret exfil tests. |
| `tests/gateway/test_pii_redaction.py` | — | PII redaction tests. |
| `tests/gateway/test_telegram_webhook_secret.py` | — | Telegram webhook secret tests. |
| `tests/hermes_cli/test_redact_config_bridge.py` | — | Config → env var bridge tests. |

`wc -l agent/redact.py`: 403 LoC.

## Canonical entry point

```python
# agent/redact.py (~line 60)
_REDACT_ENABLED = os.getenv("HERMES_REDACT_SECRETS", "true").lower() in {"1", "true", "yes", "on"}

# ~line 73
_PREFIX_PATTERNS = [
    r"sk-[A-Za-z0-9_-]{10,}",        # OpenAI / OpenRouter / Anthropic (sk-ant-*)
    r"ghp_[A-Za-z0-9]{10,}",          # GitHub PAT (classic)
    r"github_pat_[A-Za-z0-9_]{10,}",  # GitHub PAT (fine-grained)
    …
]

# Public function (not yet read but inferable):
def redact_secrets(text: str, *, code_file: bool = False) -> str:
    """Mask known secret patterns in text.
    
    Short tokens (<18 chars) fully masked; longer ones keep first 6 + last 4.
    """
```

## Architectural decisions

### AD-1: ON by default since v0.13 (after v0.12 off-default disaster)

- **Decision**: `HERMES_REDACT_SECRETS=true` by default. Per `agent/redact.py:60-71`:

  ```python
  # Snapshot at import time so runtime env mutations (e.g. LLM-generated
  # `export HERMES_REDACT_SECRETS=false`) cannot disable redaction
  # mid-session.  ON by default — secure default per issue #17691. Users who
  # need raw credential values in tool output (e.g. working on the redactor
  # itself) can opt out via `security.redact_secrets: false` in config.yaml
  # ... An opt-out warning is logged at gateway and CLI startup
  ```

- **Evidence**: v0.13 PR #21193 reversed v0.12's off-default. v0.12 PR #16794 had turned it off because false positives were corrupting patches.

- **Rationale**: The pendulum swung. Off-default leaked secrets. On-default with the false-positive fix (`code_file` opt-out, AD-4 below) is the right balance.

- **TypeScript translation**: `THEOKIT_REDACT_SECRETS=true` by default. Read at import time; cannot be mutated mid-session. Warning logged on opt-out.

### AD-2: Snapshot env var at import time — runtime mutation cannot disable

- **Decision**: `_REDACT_ENABLED` is captured once at module load. An LLM-generated `export HERMES_REDACT_SECRETS=false` in a tool call cannot disable redaction for the running process.

- **Evidence**: `agent/redact.py:60-69` (comment above). 

- **Rationale**: Prompt injection. A malicious tool result or browser page could instruct the agent to run `export HERMES_REDACT_SECRETS=false`. Without snapshotting, the next tool call would leak credentials.

- **TypeScript translation**: Same — read the env var at module init. Cannot be changed at runtime.

### AD-3: Two-bucket masking — short tokens vs long tokens

- **Decision**: Tokens shorter than 18 chars are fully masked. Longer tokens preserve first 6 + last 4 chars (e.g. `sk-ant-…XKvN`).

- **Evidence**: Module docstring at `agent/redact.py:1-7`:

  > Short tokens (< 18 chars) are fully masked. Longer tokens preserve
  > the first 6 and last 4 characters for debuggability.

- **Rationale**: Two competing goals: secure (don't reveal credentials) and debuggable (let users distinguish which key was used). Short tokens reveal too much in any prefix/suffix; long tokens have enough entropy that 10 chars don't compromise security.

- **TypeScript translation**: Same dichotomy. `maskToken(token: string): string` helper.

### AD-4: `code_file` parameter skips ENV/JSON pattern false positives

- **Decision**: When redacting code files (`.env`, `.json`, `.yaml`), pass `code_file=True` to skip patterns that commonly match legitimate variable/key names that look like secrets.

- **Evidence**: v0.13 PR #19715: "Fix: add `code_file` param to skip false-positive ENV/JSON patterns".

- **Rationale**: An `.env.example` containing `MY_SECRET=...` with literal placeholder shouldn't be redacted. JSON config keys named `apiKey` (without a value) shouldn't be redacted.

- **TypeScript translation**: `redact(text, { codeFile: true })` opt-out.

### AD-5: Prefix patterns matched against known vendor key shapes

- **Decision**: ~30 vendor-specific patterns: OpenAI, GitHub PAT (classic + fine-grained + OAuth + server-to-server + refresh), Slack tokens (`xox*-`), Google AIza, Perplexity, Fal.ai, Firecrawl, BrowserBase, Codex encrypted (gAAAA…), AWS AKIA, Stripe (live/test/restricted), SendGrid, HuggingFace, Replicate, npm, PyPI, DigitalOcean (PAT + OAuth), AgentMail, ElevenLabs, Tavily, Exa, Groq.

- **Evidence**: `agent/redact.py:72-` (the `_PREFIX_PATTERNS` list).

- **Rationale**: Most vendors use distinctive prefixes. Matching the prefix is high-precision (low false positives) and covers the common case. The patterns evolved with every vendor onboarding.

- **TypeScript translation**: Identical pattern list. Easy to keep in sync via a shared `patterns.json` file.

### AD-6: Sensitive query string + body keys

- **Decision**: When redacting URLs or JSON bodies, redact values whose keys are in `_SENSITIVE_QUERY_PARAMS` (15 keys) or `_SENSITIVE_BODY_KEYS` (14 keys). Exact match (case-insensitive), not substring.

- **Evidence**: `agent/redact.py:18-58`. Comments explicitly: "Exact match, NOT substring — `token_count` and `session_id` must NOT match."

- **Rationale**: Some opaque tokens don't match any prefix pattern (random UUIDs, short OAuth codes). Catching them by parameter name covers the rest. Exact-match prevents `token_count` from being misclassified as a secret.

- **TypeScript translation**: Same two `Set<string>` exact-match lookups.

### AD-7: Lowercase variable redaction tested for regression

- **Decision**: Test coverage for "lowercase variable redaction" regression — when env vars are uppercase (`MY_API_KEY=…`) but the redactor handles lowercase variants too (`my_api_key=…`).

- **Evidence**: v0.8 PR #5185 — "Lowercase variable redaction regression tests".

- **Rationale**: A test caught a regression where lowercased variants slipped through. Now permanently covered.

- **TypeScript translation**: Same test discipline.

### AD-8: O(n²) backtracking fixed for 100× perf improvement

- **Decision**: The original redact regex had catastrophic O(n²) backtracking. Fixed by anchoring patterns properly. 100× perf improvement on large outputs.

- **Evidence**: v0.8 PR #4962 — "O(n²) catastrophic backtracking in redact regex fixed — 100x improvement on large outputs".

- **Rationale**: A 1 MB tool output would otherwise take seconds to redact. Hot path on every tool call.

- **TypeScript translation**: Use linear-time regex patterns. Test with adversarial input (e.g. 100KB of "sk-aaaa…aaa" without a terminator) and assert <100ms.

### AD-9: Browser URL secret exfiltration block

- **Decision**: Browser navigates that load URLs containing patterns matching secrets get blocked, not just redacted.

- **Evidence**: v0.7 PR #4483 "Block secret exfiltration via browser URLs and LLM responses — scans for secret patterns in URL encoding, base64, and prompt injection vectors."

- **Rationale**: A malicious page could try to extract a secret by URL-encoding it and navigating somewhere. Browser-tool gates the navigation.

- **TypeScript translation**: `Browser.navigate(url)` calls `Security.checkUrlForSecrets(url)`; if matches, throw.

### AD-10: Credential directory protection

- **Decision**: File-tool reads/writes against `.docker`, `.azure`, `.config/gh`, `.aws`, `.ssh` are blocked.

- **Evidence**: v0.7 PR #4305, #4327 by @memosr — "Protect `.docker`, `.azure`, `.config/gh` credential directories from read/write via file tools and terminal".

- **Rationale**: Even without redacting the content, preventing access is the strongest control. Defense in depth.

- **TypeScript translation**: `Tool.preCall` veto pattern (per doc 12 AD-3) returns block message for these paths.

### AD-11: Path traversal prevention (multiple)

- **Decision**: Path traversal prevented in: skill bundle paths, profile import tar (zip-slip), skill category names, self-update zip-slip, checkpoint manager git argument injection, MCP OAuth handler, sandbox `_expand_path`.

- **Evidence**: 
  - v0.7 #3986 (skill bundle paths)
  - v0.7 #4318 (profile import zip-slip)
  - v0.6 #3844 (skill category)
  - v0.5 #3250 (self-update zip-slip)
  - v0.9 #7944 (checkpoint git argument injection)
  - v0.4 #2552 (MCP OAuth)
  - v0.4 #2685 (`_expand_path` shell injection)

- **TypeScript translation**: Every user-supplied path goes through `safeJoin(base, userInput)` that rejects traversal.

### AD-12: Discord role-allowlist guild-scoped (CVSS 8.1 close)

- **Decision**: v0.13 PR #21241 — "Discord — scope `DISCORD_ALLOWED_ROLES` to originating guild (CVSS 8.1)". Previously a user with a same-named role in any guild could DM-bypass.

- **Rationale**: Allowlists must be qualified by source. Same role name in different guilds is different identity.

- **TypeScript translation**: Authorization checks always include guild-id (or equivalent source-id) in the comparison.

## Twelve v0.13 P0/P1 security closures

Per RELEASE_v0.13.0.md "Security wave — 8 P0 closures" plus follow-ups:

1. **Secret redaction ON by default** (#21193, #17691, #20785)
2. **Discord allowlist guild-scoped** (#21241, CVSS 8.1)
3. **WhatsApp rejects strangers by default + never self-chat** (#21291, #8389)
4. **MCP OAuth credential save TOCTOU** (#21176)
5. **`hermes_cli/auth.py` credential-writer TOCTOU** (#21194)
6. **Browser cloud-metadata SSRF floor** (#21228, #16234)
7. **`hermes debug share` redact-at-upload** (#19318)
8. **Cron prompt-injection scan includes skill content** (#21350, #3968)
9. **`.env/auth.json/state.db` 0600 perms enforced on restore** (#19699)
10. **SRI integrity for dashboard plugin scripts** (#21277, #19389)
11. **Meet node server localhost-bind + token file owner-read** (#19597)
12. **Sensitive write targets cover shell RC + credential files** (#19282)

## Data structures

### Persisted

None — redaction is stateless. Configuration in `~/.hermes/config.yaml`:

```yaml
security:
  redact_secrets: true        # default — bridged to HERMES_REDACT_SECRETS env var
  redact_pii: false           # PII redaction (PR #1542 in v0.3)
```

### In-memory

- `_REDACT_ENABLED` boolean (frozen at import).
- Compiled regex list `_COMPILED_PATTERNS` (built once, reused).
- Constants `_SENSITIVE_QUERY_PARAMS`, `_SENSITIVE_BODY_KEYS`.

## Failure modes Hermes already fixed

- **v0.12 #16794**: redaction off by default after patch corruption — *reversed* in v0.13.
- **v0.13 #19715**: `code_file` param — the surgical fix for the v0.12 regression.
- **v0.8 #4962**: O(n²) backtracking — 100× perf.
- **v0.8 #5185**: lowercase variable regression.
- **v0.6 #3801**: terminalbench2 patch corruption from secret-redact false positive (the original trigger).
- **v0.13 #19318**: `hermes debug share` redact at upload.
- 12 P0/P1 closures listed above.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export class Security {
  /** Redact known secret patterns from text. */
  static redact(text: string, opts?: { codeFile?: boolean }): string;

  /** Check if a URL contains exfiltration patterns. */
  static checkUrlForSecrets(url: string): { safe: boolean; matchedPattern?: string };

  /** Validate a path against credential-directory blocklist. */
  static isProtectedPath(absolutePath: string): boolean;

  /** Get redaction enable state (frozen at module load). */
  static isRedactionEnabled(): boolean;
}

// Internal: hook into tool dispatch to auto-redact stdout/stderr
declare module "./tools" {
  interface ToolDispatchOptions {
    autoRedactOutput?: boolean;    // default true when Security.isRedactionEnabled
  }
}
```

### Internal module layout

```
packages/sdk/src/internal/security/
├── redact.ts                   # patterns, redact(), mask helpers
├── patterns.ts                 # exported pattern list (sync with Hermes)
├── url-check.ts                # checkUrlForSecrets
├── protected-paths.ts          # isProtectedPath
└── pii-redact.ts               # optional PII (phone, email, SSN) redaction
```

### Migration impact

- **Backward-compatible**: Yes. New API. Existing v1.2 callers unchanged.

## Test strategy

- For each `_PREFIX_PATTERNS` entry: positive test (real-looking key matches) + negative test (similar non-key doesn't).
- Long token: keeps first 6 + last 4.
- Short token: fully masked.
- `code_file: true`: ENV-style content not over-redacted.
- O(n²) regression test: 100 KB input redacts in <100ms.
- URL exfil patterns: encoded secrets blocked.
- Protected paths: blocklist respects symlinks.

## Open questions

- **Pattern catalog upkeep**: vendors add new key prefixes constantly. Recommend a `security/patterns.json` file + `theokit update-patterns` command that pulls from a curated registry.
- **PII**: separate concern from secret redaction. v1.3 scope or defer?
- **Per-tool override**: should a tool like `vision_analyze` opt out of result redaction? Probably yes for raw image bytes.

## References

- `referencia/hermes-agent/agent/redact.py:1-403`
- AGENTS.md (no explicit security section; spread throughout)
- RELEASE_v0.13.0.md "Security wave — 8 P0 closures"
- v0.12 PR #16794, v0.13 PR #21193 (the redaction round-trip)
- v0.13 PR #19715 (code_file fix)
- All 12 v0.13 P0/P1 PRs listed above
