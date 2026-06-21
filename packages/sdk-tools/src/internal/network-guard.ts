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

/** Fold a trailing dotted-quad (`…:1.2.3.4`) into two hex hextets; `null` if invalid. */
function foldDottedTail(s: string): string | null {
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (!tail.includes(".")) return s;
  if (isIP(tail) !== 4) return null;
  const o = tail.split(".").map(Number);
  const hi = (((o[0] as number) << 8) | (o[1] as number)).toString(16);
  const lo = (((o[2] as number) << 8) | (o[3] as number)).toString(16);
  return `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
}

/** Expand a (validated) IPv6 string to exactly 8 hextet strings; `null` if malformed. */
function expandHextets(s: string): string[] | null {
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tailGroups.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill("0"), ...tailGroups];
}

/**
 * Expand a (net.isIP-validated) IPv6 literal to its 16 bytes. Handles `::`
 * compression and a trailing dotted-quad (`::ffff:1.2.3.4`). Returns `null` if it
 * cannot be parsed (caller then fails closed).
 */
function ipv6ToBytes(ip: string): number[] | null {
  const folded = foldDottedTail(ip.toLowerCase().split("%")[0] ?? "");
  if (folded === null) return null;
  const groups = expandHextets(folded);
  if (groups === null || groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const n = Number.parseInt(g || "0", 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

function allZero(bytes: number[], from: number, to: number): boolean {
  for (let i = from; i < to; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/** Numeric IPv6 classification over the parsed 16 bytes (no string-prefix guesswork). */
function isBlockedV6Bytes(b: number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d, any spelling) → re-check the embedded IPv4.
  if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedV4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  }
  // ::1 loopback and :: unspecified.
  if (allZero(b, 0, 15) && (b[15] === 1 || b[15] === 0)) return true;
  // IPv4-compatible (deprecated) ::a.b.c.d → re-check embedded IPv4.
  if (allZero(b, 0, 12)) return isBlockedV4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`);
  // fe80::/10 link-local.
  if (b[0] === 0xfe && ((b[1] as number) & 0xc0) === 0x80) return true;
  // fc00::/7 unique-local.
  return ((b[0] as number) & 0xfe) === 0xfc;
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
    const bytes = ipv6ToBytes(ip);
    return bytes === null ? true : isBlockedV6Bytes(bytes);
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
  rawHost: string,
  options: ResolveAndScreenOptions = {},
): Promise<string[]> {
  // `URL.hostname` wraps IPv6 literals in brackets (`[::1]`) — strip them so
  // `net.isIP` recognizes the address.
  const host = rawHost.replace(/^\[|\]$/g, "");
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
