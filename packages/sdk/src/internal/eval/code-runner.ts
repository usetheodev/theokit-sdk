/**
 * M6-4 — capture an agent's code change as a gradeable artifact.
 *
 * After an agent mutates a provisioned repo, `captureArtifact` records the
 * working-tree `git diff` and validates it is coherent with the tree via a
 * reverse `git apply --check` (no re-clone needed). The resulting
 * `{ diff, applies }` becomes `EvalRowResult.artifact`, the input the Phase 5
 * verify-gate grades. Every command rides {@link SandboxBackend.execute}
 * (ADR D2 — portable across Local/Docker/E2B).
 *
 * referencia: knowledge-base/references/theocode-eval/lib/swebench-batch.ts:154
 * (build prediction from captured diff), :157 (reverse apply-check on the
 * mutated tree).
 *
 * Re-exported from `@theokit/sdk/eval` for consumers composing a code-eval
 * harness.
 *
 * @public
 */

import { shellEscapePosix } from "../../sandbox/shell-escape.js";
import type { SandboxBackend } from "../../sandbox/types.js";

/** Temp filename for the captured patch, written inside the repo dir. */
const ARTIFACT_PATCH = ".theo-artifact.patch";

/**
 * Capture the working-tree diff of `repoDir` and check it reverse-applies.
 * An empty diff (clean tree) returns `{ diff: "", applies: false }`.
 */
export async function captureArtifact(
  sandbox: SandboxBackend,
  repoDir: string,
): Promise<{ diff: string; applies: boolean }> {
  const dir = shellEscapePosix(repoDir);
  const diffRes = await sandbox.execute(`git -C ${dir} diff`);
  const diff = diffRes.stdout;
  if (diff.length === 0) return { diff: "", applies: false };

  // Write the patch into the repo and reverse-apply-check it against the
  // mutated tree — confirms the diff is coherent without re-cloning.
  await sandbox.uploadFile(`${repoDir}/${ARTIFACT_PATCH}`, diff);
  const check = await sandbox.execute(
    `git -C ${dir} apply --check --reverse ${shellEscapePosix(ARTIFACT_PATCH)}`,
  );
  return { diff, applies: check.exitCode === 0 };
}
