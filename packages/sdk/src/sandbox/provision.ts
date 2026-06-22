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
  /** Clonable repo URL or local path. */
  readonly repoUrl: string;
  /** Branch, tag, or commit SHA to check out after cloning. */
  readonly ref: string;
  /** Unique id for this row — names the target dir and any error. */
  readonly instanceId: string;
}

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

  const clone = await sandbox.execute(
    `git clone --quiet ${shellEscapePosix(repoUrl)} ${shellEscapePosix(instanceId)}`,
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

  const checkout = await sandbox.execute(
    `git -C ${shellEscapePosix(repoDir)} checkout --quiet ${shellEscapePosix(ref)}`,
  );
  if (checkout.exitCode !== 0) {
    throw new RepoProvisionError(instanceId, `checkout ${ref} failed: ${checkout.stderr.trim()}`);
  }

  return { repoDir };
}
