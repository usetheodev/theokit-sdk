---
"@theokit/sdk": minor
---

`loadProjectEnv` — read a project's `.env` without letting it move the credential store.

`process.loadEnvFile()` reads the PROJECT's `.env` into `process.env`. That is right for a provider
key and is the documented way to configure a scaffolded product. It is a hole for the handful of
variables that decide WHERE credentials live and WHAT is trusted: a cloned repository is untrusted
input, and a `.env` inside it is untrusted input the runtime is about to treat as configuration.

Without a guard, a repository shipping `THEOKIT_AUTH_HOME=/tmp/attacker-store` redirects the
credential store the moment the product starts in that directory — before any trust prompt, because
locating the store is what happens first.

`loadProjectEnv(env?, load?)` captures the sovereign keys before the load and restores them after,
including restoring "was not set" by deleting the key. `SOVEREIGN_ENV_KEYS` names them explicitly —
`THEOKIT_HOME`, `THEOKIT_AUTH_HOME`, `THEOKIT_DIR_NAME`, `THEOKIT_TRUSTED_PROVIDERS`,
`THEOKIT_REDACT_SECRETS`, `THEOKIT_OAUTH_TX_SALT` — because a convention ("anything ending in
`_HOME`") silently changes meaning as variables are added, in both directions.

`THEOKIT_API_KEY` is deliberately NOT sovereign: a project supplying its own provider key is the
intended path, and a key the project supplies is a key the project already has.

Additive. Nothing calls it yet; existing behaviour is unchanged.
