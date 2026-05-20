# D41 — OAuth 2.1 PKCE flow para MCP HTTP + token storage com keychain fallback

**Status:** Decided
**Date:** 2026-05-17

## Decision

MCP HTTP servers podem declarar OAuth via `McpAuthConfig.oauth`:

```ts
auth: {
  CLIENT_ID: "...",
  oauth: {
    authorizationEndpoint: "https://...",
    tokenEndpoint: "https://...",
    redirectMode: "manual" | "localhost",
    localhostPort?: number,  // 0 = random free port (default)
    timeoutMs?: number,       // default 5min
  }
}
```

Flow é OAuth 2.1 com PKCE (RFC 7636). Modos:

- **Manual**: imprime authorization URL no stdout; user cola code resultante via stdin. SSH-friendly.
- **Localhost**: spawn `http.createServer` em porta livre; callback URL = `http://127.0.0.1:<port>/callback`. UX melhor para dev local.

Em ambos os modos, `state` parameter é gerado random e validado no callback (RFC 6749 §4.1.1 — CSRF protection).

Token storage: tenta `keytar.setPassword("theokit-mcp", serverName, JSON.stringify(tokens))`; se keytar não disponível, fallback para `~/.theokit/mcp-tokens.json` com `fs.chmod(0o600)` (POSIX-only).

## Rationale

- **PKCE é o standard 2.1**: obrigatório para clients públicos (sem segredo) e recommended para todos os clients.
- **Manual + localhost cobrem 99% dos cenários**: SSH/headless dev (manual); local laptop (localhost).
- **State CSRF mitigation obrigatória**: localhost callback aceita qualquer GET — site malicioso na mesma máquina pode disparar fetch para `localhost:<port>/?code=attacker&state=junk`. Validação de state é a defesa standard.
- **Keychain preferido**: tokens são secret-grade material. Sistema operacional já tem secure storage (macOS Keychain, Windows Credential Manager, Linux libsecret). Keytar abstrai os 3.
- **File fallback necessário**: Alpine/musl/headless Linux + alguns CI envs falham keytar. Sem fallback, OAuth fica unusable nesses contextos.

Alternativas consideradas:

- **Device code flow** (RFC 8628): deferido — maioria dos MCP servers atuais não suporta. Pode ser adicionado v1.3 sem breaking change.
- **OAuth 2.0 clássico (com client_secret)**: rejeitado — servers modernos exigem PKCE; OAuth 2.0 sem PKCE é deprecated.
- **Auto-launch browser via `open` package**: incluso como nice-to-have mas não obrigatório (graceful fallback para "click this URL").
- **Encrypted file storage com password derivada do user**: rejeitado — overcomplicado e quebra UX (user precisa lembrar password).

## Consequences

- `keytar` declarado como **optionalDependency** + `open` igual.
- Sem keytar: log warning UMA VEZ no primeiro OAuth flow, tokens vão pro file.
- Windows sem keytar: file fallback NÃO tem chmod efetivo (POSIX-only) — documentado como gotcha; users em Windows devem instalar keytar (binding nativo funciona).
- Refresh handler automático em 401: troca refresh_token por novo access_token; serializa refreshes por `serverName` para evitar race (2 sends paralelos → 2 refreshes simultâneos → segundo rejeitado).
- Token endpoint que não retorna `expires_in`: default conservative de 3600s (RFC 6749 §5.1 recommendation) + refresh-on-401 backup.
- Authorization endpoints sem suporte PKCE (servers OAuth 2.0 antigos): erro tipado `ConfigurationError(code: "pkce_unsupported_by_server")` na primeira tentativa. Não suportado em v1.2.
- Threat model documentado: malware local com acesso ao filesystem ainda pode ler `~/.theokit/mcp-tokens.json` mesmo com chmod 600 (kernel-level read). Keychain é a defesa real; file é gracefull degradation.
