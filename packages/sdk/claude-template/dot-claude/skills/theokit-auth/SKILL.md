---
user-invocable: false
paths:
  - "**/*auth*"
  - "**/*Auth*"
  - "**/*envelope*"
description: TheoKit SDK server auth — Auth.create orchestrator, validateReturnTo, and the cross-layer error envelope
---

# TheoKit Server Auth

Server-side auth orchestrator and the cross-layer error envelope. These live
under the `@theokit/sdk/server/*` sub-paths (not the main barrel). Concrete
OAuth/email providers ship in opt-in `@theokit/auth-*` packages — the SDK only
defines the orchestrator contract.

## `Auth.create` — session + provider orchestrator

```typescript
import {
  Auth,
  validateReturnTo,
  AuthConfigError,
  AuthProviderNotFoundError,
  AuthCallbackError,
  AuthCancelledError,
  AuthSecretTooShortError,
} from "@theokit/sdk/server/auth";
import type {
  AuthProvider,
  SessionManager,
  AuthOrchestrator,
} from "@theokit/sdk/server/auth";
```

`Auth.create(opts)` returns an `AuthOrchestrator<TSession>` with 5 methods.
`providers` is optional — an empty list is the manual-`signIn`-only escape hatch.

```typescript
const auth: AuthOrchestrator<Session> = Auth.create<Session>({
  session,                 // your SessionManager<Session> implementation
  providers: [githubProvider], // AuthProvider<Profile>[] from a @theokit/auth-* package
  onSignIn: async ({ profile, provider }) => {
    return toSession(profile, provider); // returns the TSession to persist
  },
  onSignOut: async (session) => {
    /* revoke, audit, etc. */
  },
});

// OAuth flow (node:http req/res):
const redirect = await auth.startSignIn("github", req, { returnTo: "/dashboard" });
const { session, returnTo } = await auth.finishSignIn("github", req, res); // rotates session id (OWASP A07)
const current = await auth.getSession(req);
await auth.signOut(res);

// Escape hatch — persist a session directly, skipping the OAuth flow:
const s = await auth.signIn(externalProfile, "github", req, res);
```

## `validateReturnTo` — open-redirect guard (OWASP A01)

Returns a safe same-origin path. Cross-origin, protocol-relative (`//evil.com`),
empty, and defensive cases all collapse to `"/"`.

```typescript
const safe = validateReturnTo(returnTo, new URL("https://app.example.com"));
// "/dashboard" -> kept; "https://evil.com" -> "/"; undefined -> "/"
```

Typed errors: `AuthConfigError`, `AuthProviderNotFoundError`, `AuthCallbackError`,
`AuthCancelledError`, `AuthSecretTooShortError`.

## Error envelope — cross-layer boundary translation

```typescript
import {
  toEnvelope,
  fromEnvelope,
  MemoryAdapterError,
} from "@theokit/sdk/server/errors-envelope";
import type {
  TheokitErrorEnvelope,
  TheokitErrorCode,
} from "@theokit/sdk/server/errors-envelope";
```

`toEnvelope` translates any SDK error (or arbitrary thrown value) into the wire
envelope at egress; `fromEnvelope` reconstructs SDK class identity at ingress so
`instanceof` checks keep working across an IPC/serialization boundary.

```typescript
try {
  await agent.send(prompt);
} catch (err) {
  const envelope: TheokitErrorEnvelope = toEnvelope(err); // { code, message, meta?, ext? }
  send(envelope); // code is a TheokitErrorCode, e.g. "RATE_LIMITED"
}

// Inbound edge (e.g. worker receiving the envelope):
const restored = fromEnvelope(envelope); // a TheokitAgentError subclass
```
