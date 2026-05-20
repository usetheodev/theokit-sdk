# mcp-oauth-notion — OAuth 2.1 PKCE for MCP HTTP

Demonstrates OAuth 2.1 PKCE authentication for remote MCP servers (ADR D41). Uses Notion's public MCP endpoint as the concrete example, but the pattern works for any OAuth-protected MCP server (Linear, Slack remote, GitHub remote, etc.).

## What it does

**Config-only mode (default, no creds):**
- Prints the `McpServerConfig` shape that would be passed to `Agent.create`.
- Exits 0.
- Safe to run in CI / unauthenticated.

**Real flow mode (when `NOTION_OAUTH_CLIENT_ID` + a provider key are set):**
1. Creates an agent with `mcpServers: { notion: notionMcp }`.
2. On first `agent.send` that touches the Notion server, SDK triggers the PKCE flow:
   - Generates `code_verifier` + `code_challenge` (SHA256 base64url) + `state` (CSRF token).
   - Spawns a localhost HTTP server on a free port.
   - Opens browser to Notion authorization URL.
   - Waits for callback (5min timeout).
   - Validates `state` matches (CSRF defense).
   - Exchanges code for tokens via `tokenEndpoint`.
   - Stores tokens via keytar (or `~/.theokit/mcp-tokens.json` fallback).
3. Subsequent requests use the cached access token; refresh handled automatically on 401.

## Setup

### Config-only mode (always works)

```bash
pnpm install --ignore-workspace
pnpm dev
```

### Real flow mode

1. Create a Notion integration at https://www.notion.so/my-integrations
2. Set the integration's redirect URI to: `http://127.0.0.1:<port>/callback`
   (Notion accepts the literal port-substitution placeholder for desktop apps; for production use a stable URI.)
3. Copy the integration's Internal Integration Secret as `NOTION_OAUTH_CLIENT_ID`.
4. Configure `.env`:

```bash
cp .env.example .env
# Then edit .env to set:
#   NOTION_OAUTH_CLIENT_ID=<your-notion-client-id>
#   OPENROUTER_API_KEY=sk-or-...   (or ANTHROPIC_API_KEY / OPENAI_API_KEY)

pnpm dev
```

## Token storage

The SDK persists OAuth tokens (access + refresh) so the user only authenticates once per server.

**Preferred: OS keychain via [keytar](https://github.com/atom/node-keytar):**

```bash
pnpm add keytar
```

- macOS: Keychain
- Windows: Credential Manager
- Linux: libsecret (requires `gnome-keyring` or `kwallet` running)

**Fallback: file storage at `~/.theokit/mcp-tokens.json`:**

- POSIX: chmod 600 (read/write by owner only).
- **Windows: no chmod equivalent — tokens stored as plaintext readable by the owner's user account.** Install keytar on Windows for proper secret storage.

When keytar fails to load, the SDK logs a one-time warning to stderr and falls back to file storage.

## Security

- **CSRF**: `state` parameter is generated random (`crypto.randomBytes(16)`) per flow. The callback URL `state` MUST match — mismatch throws `ConfigurationError(code: "oauth_state_mismatch")`.
- **PKCE**: `code_challenge_method=S256`. The `code_verifier` never leaves the SDK process.
- **Token refresh**: serialized per server (EC-9) — 5 concurrent `agent.send` calls that hit a 401 result in exactly ONE refresh POST.
- **Without `expires_in`**: defaults to 3600s (RFC 6749 §5.1 recommendation) + refresh-on-401 backup.

## See also

- ADR D41 — `.claude/knowledge-base/adrs/D41-oauth-mcp-pkce-keychain.md`
- SDK docs: `docs.md` § "MCP OAuth 2.1"
- Golden tests: `packages/sdk/tests/golden/mcp/oauth.golden.test.ts`
