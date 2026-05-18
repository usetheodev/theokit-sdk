# Secret Redaction Discipline

> Redaction is **scrub at every output boundary**, not "scrub once".
> Tool results, logs, paste-shares, checkpoint commits — todas as
> sinks que podem leak credentials. Hermes shipou redaction off-default
> em v0.12, ligou ON-default em v0.13 com fix do false-positive. Esse
> doc é o playbook: regex patterns conservadores, env var snapshot,
> code-file escape hatch, default ON com warning ao opt-out.

## Quando aplicar

Aplique em qualquer sink que pode publicar texto:

- Tool result strings (vão pro provider's logs)
- `~/.theokit/logs/*.log`
- Stdout/stderr capture
- Paste/debug-share artifacts
- Git commits (checkpoints)
- Crash reports

Não aplique para:

- User-facing display em chat (user já viu a info)
- In-memory only state (não persiste)
- Encrypted at rest (`.env` com 0600 perms)

## Por que importa

Hermes ships **403 LoC só de redaction** (`agent/redact.py`). 13 P0/P1
security closures em v0.13. Esse não é over-engineering — é cicatriz.

Exemplos de leaks que Hermes JÁ viu shippar:

- Browser tool capturing URLs with `?token=xxx` (v0.13 #21228)
- Patch tool committing `.env` content into shadow git (multiple PRs)
- `hermes debug share` uploading agent.log with embedded secrets (v0.13 #21350)
- Shell tool's `env | grep API` printing keys verbatim
- Checkpoint snapshots of files with hardcoded creds

Cada um foi um pesadelo de "rotate all credentials NOW".

## Pattern canonical (Python — Hermes redact.py)

```python
# agent/redact.py:60-69 (CRITICAL: snapshot at import time)
import os

# Snapshot at IMPORT time. Runtime mutation cannot disable.
# Protects against LLM-generated `export HERMES_REDACT_SECRETS=false`.
_REDACT_ENABLED = (
    os.getenv("HERMES_REDACT_SECRETS", "true").lower()
    in {"1", "true", "yes", "on"}
)

# ~line 73
_PREFIX_PATTERNS = [
    # Conservative prefixes — high confidence credential markers
    r"sk-[A-Za-z0-9_-]{10,}",        # OpenAI / OpenRouter / Anthropic
    r"sk-ant-[A-Za-z0-9_-]{10,}",    # Anthropic explicit
    r"ghp_[A-Za-z0-9]{10,}",          # GitHub PAT classic
    r"github_pat_[A-Za-z0-9_]{10,}",  # GitHub PAT fine-grained
    r"glpat-[A-Za-z0-9_-]{10,}",      # GitLab PAT
    r"AKIA[A-Z0-9]{16}",              # AWS access key
    r"AIza[A-Za-z0-9_-]{35}",         # Google API key
    r"xox[bpasr]-[A-Za-z0-9-]+",      # Slack tokens
    r"sntrys_[A-Za-z0-9]+",           # Sentry
    r"rk_live_[A-Za-z0-9]+",          # Stripe restricted
    r"sk_live_[A-Za-z0-9]+",          # Stripe secret
    # ... mais ~30 patterns ...
]

def redact_secrets(text: str, *, code_file: bool = False) -> str:
    """Mask known secret patterns."""
    if not _REDACT_ENABLED:
        return text
    if code_file:
        # Code/JSON/ENV files — less aggressive; could have false-positive prefixes
        return _redact_conservative(text)
    return _redact_full(text)
```

## Two-bucket masking

Short tokens (<18 chars) fully masked. Longer ones keep prefix + suffix:

```python
def _mask_token(token: str) -> str:
    if len(token) < 18:
        return "***"
    return token[:6] + "..." + token[-4:]  # sk-abc...xyz1
```

Razão: `sk-abc...xyz1` é debuggable (sabe que é OpenAI key, sabe o prefix
+ suffix para identificar qual key — sem revelar o middle).

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/security/redact.ts

// CRITICAL: snapshot at module init. Cannot change at runtime.
const REDACT_ENABLED = (() => {
  const raw = process.env.THEOKIT_REDACT_SECRETS;
  if (raw === undefined) return true; // default ON
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
})();

if (!REDACT_ENABLED) {
  // Log warning at startup (only once)
  console.warn(
    "[theokit] Secret redaction is DISABLED via THEOKIT_REDACT_SECRETS. " +
      "Credentials may leak into tool outputs, logs, and paste artifacts.",
  );
}

// Conservative prefix list
const PREFIX_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{10,}/g,
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /glpat-[A-Za-z0-9_-]{10,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /AIza[A-Za-z0-9_-]{35}/g,
  /xox[bpasr]-[A-Za-z0-9-]+/g,
  /rk_live_[A-Za-z0-9]+/g,
  /sk_live_[A-Za-z0-9]+/g,
  // Add more as you ship integrations
];

export function redactSecrets(
  text: string,
  options?: { codeFile?: boolean },
): string {
  if (!REDACT_ENABLED) return text;
  
  let result = text;
  for (const pattern of PREFIX_PATTERNS) {
    result = result.replace(pattern, (match) => maskToken(match));
  }
  
  if (!options?.codeFile) {
    // Also redact common parameter names in URLs and bodies
    result = redactQueryParams(result);
  }
  
  return result;
}

function maskToken(token: string): string {
  if (token.length < 18) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function redactQueryParams(text: string): string {
  const sensitiveKeys = /(\b(?:access_token|password|signature|api_key|secret)\s*[=:])\s*[^\s&"',}]+/gi;
  return text.replace(sensitiveKeys, (_, prefix) => `${prefix}***`);
}
```

## Architectural decisions

### AD-1: ON by default (v0.13 reversal)

Hermes v0.12 turned it OFF because false positives corrupted patches.
v0.13 reversed → ON with `code_file` escape hatch. Trade-off
recalibrated.

**Lesson para TS**: ON by default. Document the opt-out clearly. Log
warning when user opts out (so they know they're vulnerable).

### AD-2: Snapshot at import time

Captured once at module load. Runtime mutation cannot disable.

```typescript
// Wrong: re-checks env every call
function redact(text: string): string {
  if (process.env.REDACT !== "true") return text; // ☹ injectable
  // ...
}

// Right: snapshotted at import
const REDACT_ENABLED = process.env.REDACT === "true"; // captured once
function redact(text: string): string {
  if (!REDACT_ENABLED) return text;
  // ...
}
```

Razão: prompt injection. Tool result containing
`export THEOKIT_REDACT_SECRETS=false` would otherwise disable next call.

### AD-3: Two-bucket masking — short fully masked, long shows prefix+suffix

```
sk-abc      → ***            (short, identified as token but mostly hidden)
sk-abc...xyz → sk-abc...xyz  (long, debuggable identifier preserved)
```

Razão: long tokens são unique per-account. Prefix+suffix permite
"is this the dev key or prod key?" sem revelar secret.

### AD-4: `codeFile` opt-out

Files que LEGITIMATELY contain prefix-like strings:

- `.env.example` (placeholders like `OPENAI_API_KEY=sk-xxxx`)
- `config.json` schemas com example values
- Code with hardcoded test keys (`const TEST_KEY = "sk-test"`)

Aggressive redaction corrupts these. `codeFile: true` reduces aggressiveness:

```typescript
// Quando ler/escrever code files:
const content = await readFile(path, "utf-8");
const sanitized = redactSecrets(content, { codeFile: true });
```

### AD-5: Apply redaction at OUTPUT boundaries, not at storage

Don't pre-redact stored data. Apply redaction at:

- Logger.write() — antes do log line ser persisted
- Tool dispatch result — antes do LLM ver
- Paste-share upload — antes do paste.rs
- Checkpoint commit message — antes do `git commit`

Why? Redacted data is lossy. If user later needs the original, you
can't recover. Store originals; redact on egress.

### AD-6: Test BOTH false-positive AND false-negative

```typescript
// False-negative test: real secret IS redacted
expect(redactSecrets("API key: sk-1234567890abcdef"))
  .not.toContain("sk-1234567890abcdef");

// False-positive test: legitimate content NOT mangled
expect(redactSecrets("Run `npm install sk-test-mock` to setup"))
  .toContain("sk-test-mock"); // too short to trigger; OR test codeFile opt-out
```

## Failure modes prevenidos

1. **API keys leaked to provider logs**: tool result with `env | grep` →
   model sees key → goes to Anthropic logs. Pattern: redact tool results
   antes do append no message history.

2. **Checkpoint snapshot of `.env`**: shadow git commits user's secrets.
   Pattern: redact file content before commit (with `codeFile: true` to
   preserve placeholders).

3. **Paste-share leak**: user runs `theokit share` for support, paste.rs
   gets agent.log with embedded creds. Pattern: redact at paste upload.

4. **Prompt injection disabling redaction**: malicious browser page tells
   agent to `export THEOKIT_REDACT_SECRETS=false`. Pattern: env snapshot
   at import.

## Failure modes NÃO prevenidos

- **Custom credentials sem pattern**: user-defined secrets (custom auth
  tokens, internal API keys) sem prefix conhecido. Mitigação: provide
  hook for users to add custom patterns:

  ```typescript
  Security.addPattern(/MYORG-[A-Z0-9]{32}/);
  ```

- **Credentials em arbitrary text**: "the password is hunter2" — no
  structural marker. Defesa: parametric redaction (`password=hunter2`)
  yes, free-form prose no.

- **Encoded credentials**: base64'd, URL-encoded, JSON-stringified.
  Hermes does some base64 detection; far from complete.

## Como testar

```typescript
it("redacts OpenAI key", () => {
  const result = redactSecrets("api: sk-1234567890abcdef");
  expect(result).not.toContain("sk-1234567890abcdef");
  expect(result).toContain("sk-123"); // prefix preserved
});

it("does NOT mangle placeholder in codeFile mode", () => {
  const env = "OPENAI_API_KEY=sk-yourkeyhere";
  expect(redactSecrets(env, { codeFile: true }))
    .toContain("sk-yourkeyhere"); // shorter than mask threshold OR preserved
});

it("redacts query parameter access_token", () => {
  const url = "https://api.example.com?access_token=eyJabcdef123456";
  expect(redactSecrets(url)).toMatch(/access_token=\*\*\*/);
});

it("cannot be disabled at runtime", () => {
  process.env.THEOKIT_REDACT_SECRETS = "false"; // try to disable
  // But REDACT_ENABLED was already captured at module init
  expect(redactSecrets("sk-abcdefghij")).not.toContain("sk-abcdef");
});

it("logs warning when opted out at startup", () => {
  const warnSpy = vi.spyOn(console, "warn");
  // Re-import module with env set
  vi.resetModules();
  process.env.THEOKIT_REDACT_SECRETS = "false";
  require("@/internal/security/redact");
  
  expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/redaction is DISABLED/));
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/security/`:

- `redact.ts` — `redactSecrets`, `maskToken`, pattern list
- `add-pattern.ts` — public API `Security.addPattern(regex)`
- Callers (audit):

```bash
# Find ALL output sinks that need redaction wrapper
grep -rn "fs.writeFile\|console.log\|logger.info" packages/sdk/src/ | grep -v test
```

Each result → audit: needs redaction wrap? If yes, route through
`Security.redact()`.

## Referências cruzadas

- [path-traversal-vectors.md](./path-traversal-vectors.md) — related security hardening
- [error-context-surfacing.md](./error-context-surfacing.md) — error messages podem leak
- [profile-isolation.md](./profile-isolation.md) — `.env` em profile preserved 0600

## Citações primárias

- `referencia/hermes-agent/agent/redact.py:60-69` — env snapshot
- `referencia/hermes-agent/agent/redact.py:73-105` — pattern list
- `.claude/knowledge-base/hermes-deep-dive/13-security-redaction.md:1-100` — overview
- v0.12 #16794 (OFF default), v0.13 #21193 (ON default again, with #19715 code_file escape)
- v0.8 #4962 — O(n²) catastrophic backtracking fix
