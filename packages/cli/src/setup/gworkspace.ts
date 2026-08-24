/**
 * `theokit setup gworkspace` — Google Workspace credentials walkthrough.
 *
 * Pre-flight (EC-1 + EC-2): validate `credentials.json` is a Desktop-type
 * OAuth client BEFORE shelling out to upstream `google-workspace-mcp setup`.
 * Upstream does not surface this distinction up-front and users hit
 * cryptic 401s during `accounts add` otherwise.
 *
 * After validation, this wraps `npx google-workspace-mcp setup` and
 * `accounts add` so the SDK-branded experience matches `theokit init` /
 * `theokit dev`.
 *
 * Needs: a `credentials.json` for a Desktop-type OAuth client that YOU downloaded from Google Cloud
 * Console (this command never creates one), and network access to run `npx` against the upstream
 * package. Nothing here reads an environment variable.
 *
 * Exit codes: `0` success; `2` when the credentials file is missing, unparseable, a Web-type client,
 * or its path was rejected; otherwise the upstream command's own exit code.
 *
 * Per ADR D344 v1.2: credentials live at upstream's default `~/.google-mcp/`.
 * Per ADR D345 v1.2: OAuth is fully delegated to upstream.
 *
 * @internal
 */

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import pc from "picocolors";

const UPSTREAM_PACKAGE = "google-workspace-mcp@^2.3.0";
const DEFAULT_CONFIG_DIR = join(homedir(), ".google-mcp");
const DEFAULT_CREDS_FILENAME = "credentials.json";

const PROBE_TIMEOUT_MS = 10_000;

/** Flags for {@link runGworkspaceSetup}. */
export interface GworkspaceSetupOptions {
  /**
   * Run `npx google-workspace-mcp status` INSTEAD of the setup flow, not after it: when true, the
   * function returns the probe's exit code and never runs `setup` or `accounts add`.
   */
  probe?: boolean;
  /** Validate + stage credentials, print the manual next step, and return 0 without spawning anything. */
  nonInteractive?: boolean;
  /** Override the credentials path. Default `~/.google-mcp/credentials.json`. A relative path resolves against cwd. */
  credentialsPath?: string;
}

/** Result of {@link checkCredentialsFile}. `path` is the resolved path, except on `rejected_path` where it is the raw input. */
type CredentialsCheckOutcome =
  | { kind: "ok"; path: string }
  | { kind: "missing"; path: string }
  | { kind: "malformed"; path: string; reason: string }
  | { kind: "wrong_type"; path: string }
  | { kind: "rejected_path"; path: string; reason: string };

/**
 * Reject a path that contains a `..` segment.
 *
 * A literal-substring test, not a containment test: it looks for `..` only. An ABSOLUTE path outside
 * the home directory (`/etc/passwd`) contains no `..` and passes — this narrows the shapes a
 * traversal can take, it does not confine the path to any root.
 *
 * @internal
 */
function isPathTraversal(p: string): boolean {
  return (
    p.includes("../") ||
    p.includes("..\\") ||
    p === ".." ||
    p.startsWith("../") ||
    p.startsWith("..\\")
  );
}

function readAndParseJson(
  resolved: string,
): { kind: "ok"; parsed: unknown } | { kind: "malformed"; reason: string } {
  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    return { kind: "malformed", reason: err instanceof Error ? err.message : String(err) };
  }
  try {
    return { kind: "ok", parsed: JSON.parse(raw) };
  } catch (err) {
    return { kind: "malformed", reason: err instanceof Error ? err.message : String(err) };
  }
}

function validateOAuthShape(parsed: unknown, resolved: string): CredentialsCheckOutcome {
  if (parsed === null || typeof parsed !== "object") {
    return { kind: "malformed", path: resolved, reason: "expected JSON object" };
  }
  const obj = parsed as { installed?: unknown; web?: unknown };
  if (obj.installed === undefined && obj.web !== undefined) {
    return { kind: "wrong_type", path: resolved };
  }
  if (typeof obj.installed !== "object" || obj.installed === null) {
    return {
      kind: "malformed",
      path: resolved,
      reason: "missing `installed` block (expected Desktop OAuth client shape)",
    };
  }
  return { kind: "ok", path: resolved };
}

/**
 * Classify the credentials file at `credentialsPath` before anything is shelled out to upstream.
 *
 * Never throws — every failure is one of the {@link CredentialsCheckOutcome} variants, each of which
 * has a matching operator-facing message in `describeOutcome`:
 * `rejected_path` (the path contains `..`), `missing`, `malformed` (unreadable or not JSON, or JSON
 * without an `installed` block), `wrong_type` (a Web-type client — `web` present, `installed`
 * absent, which is EC-1 and the failure upstream would only surface as a cryptic 401 much later).
 *
 * `ok` means the file parses and carries an `installed` object. It does NOT mean the client id is
 * valid, enabled, or scoped for anything — only the live upstream call can tell you that.
 */
export function checkCredentialsFile(credentialsPath: string): CredentialsCheckOutcome {
  if (isPathTraversal(credentialsPath)) {
    return { kind: "rejected_path", path: credentialsPath, reason: "path traversal" };
  }
  const resolved = resolve(credentialsPath);
  if (!existsSync(resolved)) return { kind: "missing", path: resolved };

  const parseResult = readAndParseJson(resolved);
  if (parseResult.kind === "malformed") {
    return { kind: "malformed", path: resolved, reason: parseResult.reason };
  }
  return validateOAuthShape(parseResult.parsed, resolved);
}

function describeOutcome(o: CredentialsCheckOutcome): string {
  switch (o.kind) {
    case "missing":
      return (
        `${pc.red("error: ")}credentials.json not found at ${o.path}.\n\n` +
        `To create it:\n` +
        `  1. Go to https://console.cloud.google.com/apis/credentials\n` +
        `  2. Create OAuth 2.0 Client ID — Application type: ${pc.bold("Desktop application")}\n` +
        `  3. Download the JSON and save it as ${o.path}\n`
      );
    case "malformed":
      return `${pc.red("error: ")}credentials.json could not be parsed: ${o.reason}\n  path: ${o.path}\n`;
    case "wrong_type":
      return (
        `${pc.red("error: ")}This looks like a ${pc.bold('"Web application"')} OAuth client.\n\n` +
        `Re-create as ${pc.bold('"Desktop application"')} in Google Cloud Console:\n` +
        `  https://console.cloud.google.com/apis/credentials\n` +
        `(Click "+ Create credentials" → "OAuth client ID" → Application type: ${pc.bold("Desktop app")}.)\n\n` +
        `Then re-download and save to: ${o.path}\n`
      );
    case "rejected_path":
      return `${pc.red("error: ")}credentials path rejected: ${o.reason}\n  path: ${o.path}\n`;
    case "ok":
      return "";
  }
}

function resolveCredentialsPath(opts: GworkspaceSetupOptions): string {
  if (opts.credentialsPath !== undefined && opts.credentialsPath.length > 0) {
    return isAbsolute(opts.credentialsPath) ? opts.credentialsPath : resolve(opts.credentialsPath);
  }
  return join(DEFAULT_CONFIG_DIR, DEFAULT_CREDS_FILENAME);
}

async function runProbeMode(): Promise<number> {
  process.stdout.write(`\n${pc.cyan("[probe]")} running upstream connectivity check...\n`);
  const code = await spawnUpstream(["status"], PROBE_TIMEOUT_MS);
  if (code !== 0) {
    process.stderr.write(
      `${pc.yellow("warn: ")}upstream status reported a non-zero exit (${code}). Run \`npx ${UPSTREAM_PACKAGE} accounts list\` to inspect.\n`,
    );
    return code;
  }
  return 0;
}

async function runInteractiveSetup(): Promise<number> {
  process.stdout.write(
    `\n${pc.cyan("→")} delegating to upstream installer (${UPSTREAM_PACKAGE})...\n`,
  );
  const setupCode = await spawnUpstream(["setup"]);
  if (setupCode !== 0) {
    process.stderr.write(`${pc.red("error: ")}upstream setup exited with code ${setupCode}.\n`);
    return setupCode;
  }
  process.stdout.write(`\n${pc.cyan("→")} adding default account...\n`);
  const addCode = await spawnUpstream(["accounts", "add", "default"]);
  if (addCode !== 0) {
    process.stderr.write(
      `${pc.red("error: ")}upstream \`accounts add\` exited with code ${addCode}.\n`,
    );
    return addCode;
  }
  return 0;
}

/**
 * Validate Google credentials, then hand the OAuth dance to upstream `google-workspace-mcp`.
 *
 * Side effects, in order: creates `~/.google-mcp/` (mode 0700, failure ignored); validates the
 * credentials file and STOPS with 2 if it is not a Desktop OAuth client; best-effort `chmod 600` on
 * it (ignored on Windows/FAT32, EC-6); then one of three exits — probe, non-interactive, or the
 * interactive `npx <upstream> setup` followed by `accounts add default`.
 *
 * Two things surprise callers. `--probe` REPLACES the setup instead of following it. And
 * `~/.google-mcp/` is created even when `credentialsPath` points somewhere else entirely.
 *
 * SCOPES ARE NOT NARROWED HERE, and nothing in this command can narrow them. OAuth is delegated
 * upstream (ADR D345), and the upstream MCP server asks for every scope it supports at the consent
 * screen — there is no per-product grant to choose. Write access is decided later, at runtime, by
 * `googleWorkspace({ writable: true })` in your own code. A `--writable <products>` flag used to be
 * advertised here and granted nothing (#351); it was removed rather than left implying a choice the
 * consent screen does not offer.
 *
 * The interactive path spawns `npx` with inherited stdio and no timeout, so it blocks on the
 * upstream prompts; only the probe is bounded (10s, then SIGTERM).
 *
 * @returns 0, 2 for a credentials problem, or the upstream command's exit code (1 when `npx` itself
 * could not be spawned).
 */
export async function runGworkspaceSetup(opts: GworkspaceSetupOptions): Promise<number> {
  const credentialsPath = resolveCredentialsPath(opts);

  // Ensure parent dir exists (mode 0700 where POSIX honored).
  try {
    mkdirSync(DEFAULT_CONFIG_DIR, { recursive: true, mode: 0o700 });
  } catch {
    // Non-fatal — if mkdir fails the credentials check will catch it.
  }

  // EC-1 + EC-2 + path-traversal — validate BEFORE shelling out.
  const outcome = checkCredentialsFile(credentialsPath);
  if (outcome.kind !== "ok") {
    process.stderr.write(describeOutcome(outcome));
    return 2;
  }

  // Defense-in-depth: best-effort chmod 600 on POSIX. Windows fails silently.
  try {
    chmodSync(outcome.path, 0o600);
  } catch {
    // EC-6 (DOCUMENT): non-fatal on Windows / FAT32. Carry on.
  }

  process.stdout.write(
    `${pc.green("✓")} credentials validated: ${outcome.path}\n${pc.dim("  shape: Desktop OAuth client (installed block present)")}\n`,
  );

  if (opts.probe === true) return runProbeMode();

  if (opts.nonInteractive === true) {
    process.stdout.write(
      `${pc.dim("non-interactive mode: credentials staged. Next step (manual):")}\n  ${pc.cyan(`npx ${UPSTREAM_PACKAGE} accounts add default`)}\n`,
    );
    return 0;
  }

  const interactiveCode = await runInteractiveSetup();
  if (interactiveCode !== 0) return interactiveCode;

  process.stdout.write(
    `\n${pc.green("✓")} gworkspace setup complete.\n` +
      `${pc.dim('  Next: import { googleWorkspace } from "@theokit/skills-google-workspace".')}\n`,
  );
  return 0;
}

/** Spawn `npx <UPSTREAM_PACKAGE> ...args` with an optional timeout. Returns exit code. @internal */
function spawnUpstream(args: string[], timeoutMs?: number): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn("npx", ["-y", UPSTREAM_PACKAGE, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        process.stderr.write(
          `${pc.yellow("warn: ")}upstream did not finish within ${timeoutMs}ms — killing.\n`,
        );
        try {
          child.kill("SIGTERM");
        } catch {
          // already dead
        }
      }, timeoutMs);
    }
    child.on("error", (err) => {
      if (timer !== undefined) clearTimeout(timer);
      process.stderr.write(
        `${pc.red("error: ")}failed to spawn npx: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      resolveExit(1);
    });
    child.on("exit", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolveExit(code ?? 1);
    });
  });
}
