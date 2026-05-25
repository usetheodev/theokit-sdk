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

export interface SetupOptions {
  writable?: string;
  probe?: boolean;
  credentialsPath?: string;
  nonInteractive?: boolean;
}

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
    `${pc.red("error: ")}unknown setup domain '${domain}'. ` + `Supported domains: gworkspace.\n`,
  );
  return 2;
}
