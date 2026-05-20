# Error Context Surfacing

> **Erros genéricos são banned.** "An error occurred" não diz ao user
> nada — provider? endpoint? token? rate limit? timeout? Hermes' v0.4
> #2266 corrigiu o pattern: **toda exception carries provider + endpoint
> + reason explícitos**. Esse doc é o contract para error messages no
> SDK.

## A regra

| Anti-pattern | Pattern correto |
|---|---|
| "An error occurred" | "OpenRouter API failed: 401 Unauthorized at /chat/completions" |
| "Failed to call API" | "Anthropic API rate limit exceeded (retry after 60s)" |
| "Invalid response" | "Anthropic response missing 'content' field (got: {raw_response})" |
| "Permission denied" | "Cannot write to /etc/passwd (path outside THEOKIT_HOME)" |
| Plain string throw | Custom error class with metadata fields |

## Por que importa

User chega no Discord/issue: "agent threw error, idk what". Tu pergunta
"qual error?". User cola stack trace. You spend 30min figurarando que
era rate limit no Anthropic.

Com error context: user vê "Anthropic rate limit exceeded, retry in
60s", esperna 60s, problema resolvido sozinho. Zero round-trip
contigo.

## Hermes' patterns

Hermes ships typed exceptions com 3 axes:

1. **Kind** (class hierarchy): `ProviderError`, `ToolError`, `ConfigError`
2. **Provenance** (which provider/endpoint/tool): `provider="anthropic"`,
   `endpoint="/v1/messages"`
3. **Reason** (machine-readable code + human prose): `code="rate_limit"`,
   `message="exceeded 60/minute"`

```python
# Hermes pattern (approximate, from various places)
class ProviderError(Exception):
    def __init__(self, message, *, provider=None, endpoint=None, code=None,
                 status_code=None, retry_after=None, raw_response=None):
        super().__init__(message)
        self.provider = provider
        self.endpoint = endpoint
        self.code = code
        self.status_code = status_code
        self.retry_after = retry_after
        self.raw_response = raw_response

# Usage:
raise ProviderError(
    "Anthropic API rate limit exceeded",
    provider="anthropic",
    endpoint="/v1/messages",
    code="rate_limit",
    status_code=429,
    retry_after=60,
)
```

## TypeScript equivalent

```typescript
// packages/sdk/src/errors.ts (existing — extender)
export class TheokitAgentError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TheokitAgentError";
  }
}

export class ProviderError extends TheokitAgentError {
  constructor(
    message: string,
    public readonly metadata: {
      provider: string;
      endpoint: string;
      code: ProviderErrorCode;
      statusCode?: number;
      retryAfter?: number; // seconds
      raw?: unknown;
    },
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ProviderError";
  }
}

export type ProviderErrorCode =
  | "rate_limit"
  | "auth_failed"
  | "invalid_request"
  | "timeout"
  | "server_error"
  | "context_too_long"
  | "content_filtered"
  | "model_unavailable"
  | "unknown";

// Usage:
throw new ProviderError(
  "Anthropic API rate limit exceeded (retry in 60s)",
  {
    provider: "anthropic",
    endpoint: "/v1/messages",
    code: "rate_limit",
    statusCode: 429,
    retryAfter: 60,
  },
);
```

## Pattern: error code consumível pelo SDK consumer

Code é machine-readable. Permite caller logic:

```typescript
try {
  await agent.send("...");
} catch (err) {
  if (err instanceof ProviderError) {
    switch (err.metadata.code) {
      case "rate_limit":
        await wait(err.metadata.retryAfter ?? 60);
        return retry();
      case "auth_failed":
        throw new Error(`Check your API key for ${err.metadata.provider}`);
      case "context_too_long":
        // Trigger compression
        break;
      default:
        throw err;
    }
  }
  throw err;
}
```

Sem error code, caller would parse string ("if message contains 'rate
limit'..." — fragile).

## Pattern: error transformation at boundaries

Provider returns raw HTTP error. SDK transforms:

```typescript
// packages/sdk/src/internal/providers/anthropic.ts
async function anthropicCall(endpoint: string, body: unknown): Promise<Response> {
  const res = await fetch(`https://api.anthropic.com${endpoint}`, {
    method: "POST",
    headers: { /* ... */ },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const code = mapAnthropicError(res.status, errBody);
    
    throw new ProviderError(
      formatErrorMessage(code, errBody),
      {
        provider: "anthropic",
        endpoint,
        code,
        statusCode: res.status,
        retryAfter: parseRetryAfter(res.headers),
        raw: errBody,
      },
    );
  }
  
  return res;
}

function mapAnthropicError(status: number, body: unknown): ProviderErrorCode {
  if (status === 401) return "auth_failed";
  if (status === 429) return "rate_limit";
  if (status === 400 && /context.*too.*long/i.test(JSON.stringify(body))) return "context_too_long";
  if (status >= 500) return "server_error";
  return "unknown";
}
```

Each provider's transport has own mapper. SDK consumer gets uniform
`ProviderError` regardless of underlying.

## Pattern: redacted error messages

Error mensage pode leak secrets:

```typescript
// ☹ ANTI-PATTERN
throw new ProviderError(
  `Failed: ${err.message}`, // err.message: "401 token sk-1234567890 invalid"
  // Secret in message → goes to logs, support tickets, etc.
);

// ✅ CORRECT
import { redactSecrets } from "@/internal/security/redact";

throw new ProviderError(
  redactSecrets(err.message), // → "401 token sk-123...invalid"
  { provider, endpoint, code },
);
```

## Pattern: error message localization (futuro)

Para SDK end-user-facing, support multi-locale:

```typescript
// packages/sdk/src/internal/errors/messages.ts
const ERROR_MESSAGES = {
  rate_limit: {
    en: "{provider} API rate limit exceeded (retry in {retryAfter}s)",
    "pt-BR": "Limite de taxa da API {provider} excedido (tente novamente em {retryAfter}s)",
  },
  // ...
};

function formatErrorMessage(
  code: ProviderErrorCode,
  meta: { provider: string; retryAfter?: number },
  locale: string = "en",
): string {
  const template = ERROR_MESSAGES[code]?.[locale] ?? ERROR_MESSAGES[code]?.en ?? "Unknown error";
  return template
    .replace("{provider}", meta.provider)
    .replace("{retryAfter}", String(meta.retryAfter ?? "?"));
}
```

Hermes ships 7 locales (v0.13 #20430-20474). Theokit pode começar com
en, add pt-BR depois.

## Architectural decisions

### AD-1: Error code é finite enum, não free-form

```typescript
type ProviderErrorCode = "rate_limit" | "auth_failed" | ...; // exhaustive

// Adding a new code = explicit decision + test coverage
```

Razão: caller can do `switch` exaustivo (TS compiler enforces). Free-form
strings drift over releases.

### AD-2: Original error preserved em `cause`

```typescript
try {
  // ...
} catch (err) {
  throw new ProviderError(message, metadata, err); // preserve original
}

// Consumer pode walk:
catch (e) {
  if (e instanceof ProviderError) {
    console.log("Wrapped:", e.message);
    console.log("Original:", e.cause);
  }
}
```

Native ES2022 `Error.cause` é supported em Node 20+. Use it.

### AD-3: Stack trace cross-boundary

```typescript
// V8 captures stack at throw time
throw new ProviderError(...);
// Stack shows where SDK created the error, not where fetch failed

// Better: include cause stack
class ProviderError extends Error {
  constructor(message: string, public metadata: Meta, public cause?: unknown) {
    super(message);
    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}
```

Logs show: SDK created error → caused by → original fetch error. Full
trail.

### AD-4: Logging vs surfacing

Erros bubble para caller via throw. Logger ALSO records:

```typescript
function logAndRethrow(err: TheokitAgentError): never {
  logger.error(
    err.message,
    {
      name: err.name,
      ...err.metadata,
      stack: err.stack,
    },
  );
  throw err;
}
```

Caller pode catch and ignore (best-effort), but log persistence guarantees
forensics.

## Failure modes prevenidos

1. **User can't diagnose**: error message says exactly what + which
   provider + what to do.

2. **Caller can't react**: enum code permits programmatic retry/escalate.

3. **Secrets in logs**: redaction layer wraps error messages.

4. **Lost root cause**: `cause` chain preserva original.

## Failure modes NÃO prevenidos

- **Wrong error wrapping**: SDK catches everything as ProviderError,
  hiding bugs. Defesa: only wrap WHEN it's a provider error; rethrow
  unknown errors as-is.

- **Error message too long**: streaming response error containing 100k
  chars of provider response. Defesa: truncate `raw` field, save full
  to log only.

- **i18n drift**: pt-BR translation rota out of date with en. Defesa:
  fallback to en + lint that en is base of truth.

## Como testar

```typescript
it("ProviderError has provider + endpoint + code", () => {
  const err = new ProviderError("msg", {
    provider: "anthropic",
    endpoint: "/v1/messages",
    code: "rate_limit",
  });
  
  expect(err.metadata.provider).toBe("anthropic");
  expect(err.metadata.endpoint).toBe("/v1/messages");
  expect(err.metadata.code).toBe("rate_limit");
});

it("rate_limit error preserves retryAfter", () => {
  const err = new ProviderError("...", {
    provider: "anthropic", endpoint: "/v1/messages",
    code: "rate_limit", retryAfter: 60,
  });
  expect(err.metadata.retryAfter).toBe(60);
});

it("cause is preserved", () => {
  const original = new Error("network EAI");
  const wrapped = new ProviderError("Failed", { /*...*/ }, original);
  expect(wrapped.cause).toBe(original);
});

it("secret in message is redacted", () => {
  const err = new ProviderError(
    redactSecrets("Invalid token sk-1234567890abcdef"),
    { provider: "anthropic", endpoint: "/v1/messages", code: "auth_failed" },
  );
  expect(err.message).not.toContain("sk-1234567890abcdef");
});

it("caller can react via switch", async () => {
  const handler = vi.fn();
  
  try {
    throw new ProviderError("rate", { provider: "anthropic", endpoint: "/v1/messages", code: "rate_limit", retryAfter: 5 });
  } catch (err) {
    if (err instanceof ProviderError) {
      switch (err.metadata.code) {
        case "rate_limit":
          handler("wait", err.metadata.retryAfter);
          break;
        case "auth_failed":
          handler("auth_error");
          break;
      }
    }
  }
  
  expect(handler).toHaveBeenCalledWith("wait", 5);
});
```

## Onde wirar no SDK

`packages/sdk/src/errors.ts`:

- `TheokitAgentError` (already exists — base class)
- Adicionar `ProviderError`, `ToolError`, `MemoryError`, `ConfigurationError`
- Cada um com `metadata` typed

`packages/sdk/src/internal/providers/<name>/`:

- Each transport mapper translates raw errors to ProviderError
- Use `mapXyzError(status, body)` helpers

## Referências cruzadas

- [secret-redaction-discipline.md](./secret-redaction-discipline.md) — wrap error messages
- [graceful-degradation.md](./graceful-degradation.md) — fallback when error code permite
- [provider-as-plugin.md](./provider-as-plugin.md) — each provider's transport tem own mapper

## Citações primárias

- v0.4 #2266 — error context PR (canonical fix)
- `referencia/hermes-agent/AGENTS.md` — "errors with provider + endpoint context"
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:319` — "Surface errors with provider + endpoint context"
