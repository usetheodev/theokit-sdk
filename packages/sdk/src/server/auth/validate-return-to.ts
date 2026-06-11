/**
 * @theokit/sdk/server/auth — same-origin returnTo validator
 *
 * Per v1.1 EC-2 MUST FIX — OWASP A01:2021 open-redirect mitigation.
 *
 * Without this check, attacker craft `/login?returnTo=https://evil.com` would
 * cause post-login redirect to attacker domain with authenticated session cookie.
 *
 * Rules:
 *   - undefined/empty returnTo → default '/'
 *   - protocol-relative `//evil.com` → default '/' (URL parser would resolve to baseUrl protocol)
 *   - absolute URL with origin ≠ baseUrl.origin → default '/' (cross-origin redirect)
 *   - absolute URL with origin === baseUrl.origin → keep (same-origin allowed)
 *   - relative path starting with '/' → keep (same-app navigation)
 *   - relative path not starting with '/' → default '/' (defensive)
 */
export function validateReturnTo(returnTo: string | undefined, baseUrl: URL): string {
  if (!returnTo || typeof returnTo !== "string" || returnTo.trim() === "") {
    return "/";
  }

  const trimmed = returnTo.trim();

  // Protocol-relative URLs (//evil.com) are dangerous — browser would resolve to current protocol
  if (trimmed.startsWith("//")) {
    return "/";
  }

  // Try absolute URL parsing first
  if (URL.canParse(trimmed)) {
    const parsed = new URL(trimmed);
    if (parsed.origin === baseUrl.origin) {
      // Same-origin absolute URL — return the pathname+search+hash portion (drop origin)
      return parsed.pathname + parsed.search + parsed.hash;
    }
    // Cross-origin — reject
    return "/";
  }

  // Not parseable as absolute. Must start with '/' to be a valid relative path
  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  // Anything else (e.g., "javascript:alert", "data:..." that wasn't parseable, or bare strings) → default
  return "/";
}
