/**
 * `theokit setup <domain>` — top-level CLI verb dispatcher.
 *
 * Currently knows ONE domain: `gworkspace`. Future domains (`notion`,
 * `linear`, etc.) plug in the same way.
 *
 * Per ADR D346, `setup` is reserved for credential staging + connectivity
 * probes for third-party integrations. The flow shells out to the upstream
 * tool's own setup whenever that's safer than re-implementing OAuth.
 *
 * @internal
 */

import pc from "picocolors";

import { type GworkspaceSetupOptions, runGworkspaceSetup } from "../setup/gworkspace.js";

/** Flags for {@link runSetup}, forwarded verbatim to the domain handler. */
export interface SetupOptions {
  /** Comma-separated product list. Advisory only — see `GworkspaceSetupOptions.writable`. */
  writable?: string;
  /** Run the upstream connectivity check INSTEAD of the setup flow, not after it. */
  probe?: boolean;
  /** Override the credentials file path. Default `~/.google-mcp/credentials.json`. */
  credentialsPath?: string;
  /** Stage credentials and stop, printing the manual next step. Suitable for CI. */
  nonInteractive?: boolean;
}

/**
 * Dispatch `theokit setup <domain>` to its handler. `gworkspace` is the only domain that exists.
 *
 * @returns 2 for an unknown domain, otherwise whatever the domain handler returned — which for
 * `gworkspace` includes the upstream installer's own exit code.
 */
export async function runSetup(domain: string, opts: SetupOptions): Promise<number> {
  if (domain === "gworkspace") {
    const gworkspaceOpts: GworkspaceSetupOptions = {
      writable: opts.writable,
      probe: opts.probe === true,
      nonInteractive: opts.nonInteractive === true,
      ...(opts.credentialsPath !== undefined ? { credentialsPath: opts.credentialsPath } : {}),
    };
    return await runGworkspaceSetup(gworkspaceOpts);
  }
  process.stderr.write(
    `${pc.red("error: ")}unknown setup domain '${domain}'. Supported domains: gworkspace.\n`,
  );
  return 2;
}
