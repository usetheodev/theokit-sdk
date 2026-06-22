/**
 * M6-3 — portable repo provisioner for the eval harness.
 *
 * Clones a repository and checks out a ref into an isolated working dir, issuing
 * every git command through {@link SandboxBackend.execute} (ADR D2 — same code
 * runs on Local/Docker/E2B; never a direct `child_process` import). Promotes
 * theocode's `prepareRepo` (`swebench-provision.ts:37`) onto the SDK's sandbox
 * abstraction.
 *
 * referencia: knowledge-base/references/theocode-eval/lib/swebench-provision.ts:37
 * (clone+checkout), :13 (ProvisionError with instanceId).
 *
 * @public
 */

import { TheokitAgentError } from "../errors.js";
import { shellEscapePosix } from "./shell-escape.js";
import type { SandboxBackend } from "./types.js";

/**
 * Raised when cloning or checking out a repo fails. Carries the `instanceId`
 * so a batch run can attribute the failure to the offending dataset row.
 */
export class RepoProvisionError extends TheokitAgentError {
  override readonly name = "RepoProvisionError";

  constructor(
    readonly instanceId: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(`[${instanceId}] ${message}`, {
      code: "repo_provision_failed",
      isRetryable: false,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
  }
}

/** Options for {@link provisionRepo}. */
export interface ProvisionRepoOptions {
  /**
   * Clonable repo URL or local path. SECURITY: when this comes from an
   * untrusted dataset, the value is passed to `git clone` after a `--`
   * end-of-options terminator (no flag injection) and with the `ext::`
   * transport disabled (no arbitrary-command transport).
   */
  readonly repoUrl: string;
  /** Branch, tag, or commit SHA to check out. Rejected if it begins with `-`. */
  readonly ref: string;
  /**
   * Unique id for this row — names the target dir and any error. Validated to
   * `[A-Za-z0-9._-]` (no path traversal) since it becomes a directory name.
   */
  readonly instanceId: string;
}

/** Reject ids that would escape the workdir or be parsed as a git flag. */
const SAFE_INSTANCE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Clone `repoUrl` into `<sandbox workdir>/<instanceId>` and check out `ref`.
 * Returns the absolute `repoDir` (resolved via `git rev-parse --show-toplevel`,
 * which is portable across backends). Throws {@link RepoProvisionError} naming
 * the `instanceId` when clone or checkout exits non-zero.
 */
export async function provisionRepo(
  sandbox: SandboxBackend,
  opts: ProvisionRepoOptions,
): Promise<{ repoDir: string }> {
  const { repoUrl, ref, instanceId } = opts;

  // Validate untrusted-derivable inputs before they reach git/the shell.
  if (!SAFE_INSTANCE_ID.test(instanceId)) {
    throw new RepoProvisionError(
      instanceId,
      "invalid instanceId: must match [A-Za-z0-9._-] (no path traversal)",
    );
  }
  if (ref.startsWith("-")) {
    throw new RepoProvisionError(instanceId, `invalid ref: must not begin with '-' (got ${ref})`);
  }

  // `--` terminates options (no `--upload-pack=` flag injection); `protocol.ext.allow=never`
  // blocks the `ext::` arbitrary-command transport. `file`/`https` stay allowed.
  const clone = await sandbox.execute(
    `git -c protocol.ext.allow=never clone --quiet -- ${shellEscapePosix(repoUrl)} ${shellEscapePosix(instanceId)}`,
  );
  if (clone.exitCode !== 0) {
    throw new RepoProvisionError(instanceId, `clone failed: ${clone.stderr.trim()}`);
  }

  const top = await sandbox.execute(
    `git -C ${shellEscapePosix(instanceId)} rev-parse --show-toplevel`,
  );
  if (top.exitCode !== 0) {
    throw new RepoProvisionError(instanceId, `resolve repoDir failed: ${top.stderr.trim()}`);
  }
  const repoDir = top.stdout.trim();

  // `ref` is validated above not to begin with `-`, so it cannot be parsed as a flag.
  const checkout = await sandbox.execute(
    `git -C ${shellEscapePosix(repoDir)} checkout --quiet ${shellEscapePosix(ref)}`,
  );
  if (checkout.exitCode !== 0) {
    throw new RepoProvisionError(instanceId, `checkout ${ref} failed: ${checkout.stderr.trim()}`);
  }

  return { repoDir };
}
