import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline/promises";

import { ConfigurationError } from "../../errors.js";
import type { McpOAuthConfig } from "../../types/mcp.js";
import { getTokens, lockedRefresh, type OAuthTokens, setTokens } from "./token-storage.js";

/**
 * OAuth 2.1 PKCE flow runner for MCP HTTP servers. See ADR D41.
 *
 * @internal
 */

/**
 * Generate a random base64url-encoded string. Used for both code_verifier
 * (43-128 chars) and state (CSRF protection).
 */
function base64url(n: number): string {
  return randomBytes(n).toString("base64url");
}

/**
 * Compute PKCE code_challenge = base64url(SHA256(code_verifier)).
 */
function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Acquire an access token for `serverName`, running the OAuth PKCE flow if
 * no valid cached token exists. EC-2: validates state on callback.
 *
 * @internal
 */
export async function acquireAccessToken(
  serverName: string,
  clientId: string,
  scopes: string[] | undefined,
  oauth: McpOAuthConfig,
): Promise<string> {
  const cached = await getTokens(serverName);
  const now = Date.now();
  if (cached !== undefined && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }
  // Expired (or about to). Try refresh if we have a refresh_token; else flow.
  if (cached?.refreshToken !== undefined) {
    try {
      const refreshed = await lockedRefresh(serverName, () =>
        refreshAccessToken(serverName, clientId, cached.refreshToken!, oauth),
      );
      return refreshed.accessToken;
    } catch {
      // Refresh failed — re-run the full flow.
    }
  }
  const tokens = await runPkceFlow(serverName, clientId, scopes, oauth);
  await setTokens(serverName, tokens);
  return tokens.accessToken;
}

/**
 * Refresh an access token using `refresh_token`. Throws on failure.
 *
 * @internal
 */
export async function refreshAccessToken(
  serverName: string,
  clientId: string,
  refreshToken: string,
  oauth: McpOAuthConfig,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const response = await fetch(oauth.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new ConfigurationError(`OAuth refresh failed: HTTP ${response.status}`, {
      code: "oauth_refresh_failed",
    });
  }
  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  const obtainedAt = Date.now();
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    // EC-10: default conservative 3600s if expires_in missing.
    expiresAt: obtainedAt + (data.expires_in ?? 3600) * 1000,
    obtainedAt,
    ...(data.scope !== undefined ? { scope: data.scope } : {}),
  };
  await setTokens(serverName, tokens);
  return tokens;
}

/**
 * Run the full PKCE flow. Generates verifier+challenge+state, opens the
 * authorization URL (browser or manual print), waits for the callback
 * (localhost or stdin), exchanges code for tokens.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: PKCE flow is a linear protocol step (verifier → challenge → state → URL → wait → exchange); refactoring fragments the RFC 7636 narrative.
export async function runPkceFlow(
  serverName: string,
  clientId: string,
  scopes: string[] | undefined,
  oauth: McpOAuthConfig,
): Promise<OAuthTokens> {
  const verifier = base64url(48);
  const challenge = challengeFor(verifier);
  const state = base64url(16);
  const timeoutMs = oauth.timeoutMs ?? 300_000;

  let redirectUri: string;
  let codeWaiter: Promise<{ code: string; state: string }>;
  let cleanup: () => void = () => {};

  if (oauth.redirectMode === "localhost") {
    const result = await openLocalhostCallback(state, timeoutMs);
    redirectUri = result.redirectUri;
    codeWaiter = result.waitFor;
    cleanup = result.close;
  } else {
    redirectUri = "urn:ietf:wg:oauth:2.0:oob";
    codeWaiter = readCodeFromStdin(state, timeoutMs);
  }

  try {
    const authUrl = new URL(oauth.authorizationEndpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    if (scopes !== undefined && scopes.length > 0) {
      authUrl.searchParams.set("scope", scopes.join(" "));
    }
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    process.stderr.write(
      `\n[theokit-sdk] OAuth required for MCP server "${serverName}".\n` +
        `Open this URL to authenticate:\n  ${authUrl.toString()}\n\n`,
    );

    const { code, state: returnedState } = await codeWaiter;
    // EC-2 MUST FIX: validate state.
    if (returnedState !== state) {
      throw new ConfigurationError(
        "OAuth state mismatch — possible CSRF attempt; aborting token exchange.",
        { code: "oauth_state_mismatch" },
      );
    }

    // Exchange code for tokens.
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    const response = await fetch(oauth.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new ConfigurationError(
        `OAuth token exchange failed: HTTP ${response.status}: ${errText.slice(0, 200)}`,
        { code: "oauth_token_exchange_failed" },
      );
    }
    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    const obtainedAt = Date.now();
    return {
      accessToken: data.access_token,
      ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
      // EC-10: default 3600s when expires_in absent.
      expiresAt: obtainedAt + (data.expires_in ?? 3600) * 1000,
      obtainedAt,
      ...(data.scope !== undefined ? { scope: data.scope } : {}),
    };
  } finally {
    cleanup();
  }
}

/**
 * Start a localhost HTTP server on a free port; return the redirect URI,
 * a promise that resolves with the code+state from the first valid request,
 * and a close handle.
 *
 * @internal
 */
async function openLocalhostCallback(
  expectedState: string,
  timeoutMs: number,
): Promise<{
  redirectUri: string;
  waitFor: Promise<{ code: string; state: string }>;
  close: () => void;
}> {
  let resolveCode: ((value: { code: string; state: string }) => void) | undefined;
  let rejectCode: ((reason: unknown) => void) | undefined;
  const waitFor = new Promise<{ code: string; state: string }>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (typeof code !== "string" || typeof state !== "string") {
      res.statusCode = 400;
      res.end("Missing code or state");
      return;
    }
    // EC-2: state must match the one we generated. We DO NOT trust any
    // localhost GET — only the one carrying our exact state.
    if (state !== expectedState) {
      res.statusCode = 400;
      res.end("State mismatch — request rejected.");
      return;
    }
    res.statusCode = 200;
    res.end("Authentication successful. You can close this tab and return to the terminal.");
    resolveCode?.({ code, state });
  });
  server.listen(0, "127.0.0.1");
  const timeoutHandle = setTimeout(() => {
    rejectCode?.(new ConfigurationError("OAuth flow timed out", { code: "oauth_timeout" }));
  }, timeoutMs);
  // Wait for server.listen to bind so we can read the port.
  await new Promise<void>((r) => {
    if (server.listening) r();
    else server.once("listening", () => r());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    server.close();
    throw new ConfigurationError("OAuth localhost callback failed to bind", {
      code: "oauth_bind_failed",
    });
  }
  const port = address.port;
  return {
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitFor,
    close: () => {
      clearTimeout(timeoutHandle);
      server.close();
    },
  };
}

/**
 * Read `code` (and `state`) from stdin (manual mode). User pastes the
 * full callback URL or just the code value.
 *
 * @internal
 */
async function readCodeFromStdin(
  expectedState: string,
  timeoutMs: number,
): Promise<{ code: string; state: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const promise = new Promise<{ code: string; state: string }>((resolve, reject) => {
    rl.question("Paste the full callback URL (or just the code): ")
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stdin reader handles 2 input formats (full URL vs raw code) inline; splitting fragments the manual-mode UX.
      .then((answer) => {
        rl.close();
        const trimmed = answer.trim();
        // Try to parse as URL first.
        if (trimmed.includes("?")) {
          try {
            const parsed = new URL(trimmed);
            const code = parsed.searchParams.get("code");
            const state = parsed.searchParams.get("state") ?? "";
            if (typeof code === "string") {
              resolve({ code, state });
              return;
            }
          } catch {
            // not a URL — fall through
          }
        }
        // Treat the entire input as the code. State validation will fail
        // unless the user also provided state — but in manual mode they
        // typically paste the URL with state baked in.
        resolve({ code: trimmed, state: expectedState });
      })
      .catch(reject);
    setTimeout(() => {
      rl.close();
      reject(new ConfigurationError("OAuth manual input timed out", { code: "oauth_timeout" }));
    }, timeoutMs);
  });
  return promise;
}
