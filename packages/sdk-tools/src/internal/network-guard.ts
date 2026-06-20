/**
 * SSRF guard for network tools (M3-1).
 *
 * `isBlockedIp` is a pure block-list of the canonical private/loopback/link-local/
 * CGNAT/metadata/reserved ranges (IPv4 + IPv6, with IPv4-mapped unwrap).
 * `resolveAndScreen` resolves ALL of a host's addresses and rejects if any is
 * blocked. `screenedFetch` fetches with `redirect:"manual"` and re-screens every
 * hop. `lookup`/`fetchImpl` are injectable so the DNS + redirect paths are
 * deterministically testable without real network access.
 *
 * Design: blueprint m3-ssrf-guard ADRs D1-D6. Node builtins only (zero new deps).
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { ConfigurationError } from "@theokit/sdk";

/** Thrown when a host/redirect resolves to a blocked (private/reserved) address. */
export class SsrfBlockedError extends ConfigurationError {
  override readonly name = "SsrfBlockedError";
  constructor(host: string, detail?: string) {
    super(
      `Blocked request to "${host}"${detail ? ` (${detail})` : ""}: address is private, loopback, link-local, or reserved (SSRF guard).`,
      { code: "ssrf_blocked" },
    );
  }
}

/** Parse an IPv4 dotted-quad to a 32-bit unsigned integer (assumes a valid literal). */
function v4ToInt(ip: string): number {
  const parts = ip.split(".");
  return (
    ((Number(parts[0]) << 24) |
      (Number(parts[1]) << 16) |
      (Number(parts[2]) << 8) |
      Number(parts[3])) >>>
    0
  );
}

/** True if the IPv4 address (as int) falls inside `base/prefix`. */
function inV4Cidr(ipInt: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (v4ToInt(base) & mask);
}

const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this host"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + cloud metadata
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, prefix]) => inV4Cidr(n, base, prefix));
}

/** Extract the IPv4 tail of an IPv4-mapped IPv6 literal (`::ffff:a.b.c.d` or `::ffff:7f00:1`). */
function ipv4Mapped(ip: string): string | undefined {
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1] as string, 16);
    const lo = Number.parseInt(hex[2] as string, 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return undefined;
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true; // fe80::/10 link-local
  }
  return lower.startsWith("fc") || lower.startsWith("fd"); // fc00::/7 ULA
}

/**
 * True if `ip` is a blocked address (private/loopback/link-local/CGNAT/metadata/
 * reserved). A non-IP literal returns `true` (fail closed — callers resolve names
 * to IPs first via {@link resolveAndScreen}).
 */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedV4(ip);
  if (fam === 6) {
    const mapped = ipv4Mapped(ip);
    if (mapped) return isBlockedV4(mapped);
    return isBlockedV6(ip);
  }
  return true;
}

type LookupFn = (host: string, opts: { all: true }) => Promise<Array<{ address: string }>>;

/** Options for {@link resolveAndScreen}. */
export interface ResolveAndScreenOptions {
  /** DNS resolver (injectable for tests); defaults to `node:dns/promises` lookup. */
  lookup?: LookupFn;
}

/**
 * Resolve `host` to ALL its addresses and screen each. Throws {@link SsrfBlockedError}
 * if any resolved address is blocked (or if `host` is a blocked IP literal, or if
 * resolution yields no address). Returns the resolved IPs otherwise.
 */
export async function resolveAndScreen(
  host: string,
  options: ResolveAndScreenOptions = {},
): Promise<string[]> {
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) throw new SsrfBlockedError(host);
    return [host];
  }
  const lookup = options.lookup ?? (dnsLookup as unknown as LookupFn);
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) throw new SsrfBlockedError(host, "no addresses");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfBlockedError(host, a.address);
  }
  return addrs.map((a) => a.address);
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The next URL to follow for a redirect response, or `undefined` if `res` is not a
 * followable redirect. Throws {@link SsrfBlockedError} for a non-http(s) target.
 */
function redirectTarget(res: Response, current: string, originalUrl: string): string | undefined {
  const location = res.headers.get("location");
  if (!REDIRECT_STATUSES.has(res.status) || !location) return undefined;
  const next = new URL(location, current);
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    throw new SsrfBlockedError(originalUrl, `non-http redirect to ${next.protocol}`);
  }
  return next.href;
}

/** Options for {@link screenedFetch}. */
export interface ScreenedFetchOptions {
  /** Fetch implementation (injectable for tests); defaults to global `fetch`. */
  fetchImpl?: FetchFn;
  /** DNS resolver (injectable for tests). */
  lookup?: LookupFn;
  /** Max redirect hops to follow (default 5). */
  maxRedirects?: number;
  /** Skip SSRF screening entirely (opt-out for local-dev tools). Default false. */
  allowPrivateHosts?: boolean;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

/**
 * Fetch `url` with SSRF screening: screens the host (unless `allowPrivateHosts`),
 * sets `redirect:"manual"`, and re-screens every redirect hop (rejecting a hop to a
 * blocked host or a non-http(s) target). Throws {@link SsrfBlockedError} on a block
 * or on exceeding `maxRedirects`.
 */
export async function screenedFetch(
  url: string,
  options: ScreenedFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? (fetch as FetchFn);
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!options.allowPrivateHosts) {
      await resolveAndScreen(new URL(current).hostname, { lookup: options.lookup });
    }
    const res = await fetchImpl(current, { redirect: "manual", signal: options.signal });
    const next = redirectTarget(res, current, url);
    if (next === undefined) return res;
    current = next;
  }
  throw new SsrfBlockedError(url, "too many redirects");
}
