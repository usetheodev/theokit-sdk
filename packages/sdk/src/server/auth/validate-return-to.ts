/**
 * Clamp a caller-supplied `returnTo` to a same-origin destination, falling back
 * to `'/'` for anything else. This is the open-redirect guard for a post-login
 * redirect (`@theokit/sdk/server/auth`; OWASP A01:2021, v1.1 EC-2). Without it,
 * `/login?returnTo=https://evil.com` would send the freshly authenticated session
 * to an attacker's domain.
 *
 *   validateReturnTo(req.query.returnTo, new URL("https://app.example.com"));
 *
 * Pure and synchronous. It never throws and always returns a string:
 *   - undefined / empty / whitespace-only `returnTo` -> `'/'`
 *   - protocol-relative `//evil.com` -> `'/'` (a browser would resolve it against
 *     the current protocol)
 *   - absolute URL whose origin differs from `baseUrl.origin` -> `'/'`
 *   - absolute URL on `baseUrl.origin` -> its `pathname + search + hash`, with
 *     the origin dropped
 *   - relative path starting with `'/'` -> kept verbatim
 *   - anything else, including `javascript:` and `data:` -> `'/'`
 *
 * `baseUrl` is compared by ORIGIN only (scheme + host + port); its path is
 * ignored, so an app mounted under a sub-path gets no extra containment from it.
 *
 * Trap: this defends the origin, not the route. A same-origin relative path is
 * returned unchanged — `..` segments included, and with no notion of whether the
 * user is allowed there. Authorise the destination separately.
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
