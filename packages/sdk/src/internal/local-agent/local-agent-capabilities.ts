/**
 * What a local agent cannot do, answered without throwing.
 *
 * `SDKAgent` is one interface over two runtimes, and a local agent genuinely has no artifacts — the
 * LSP finding this closes is that `downloadArtifact` rejected with `UnsupportedRunOperationError`
 * and nothing let a caller ASK first. `supports`/`unsupportedReason` are that question, and they
 * live here rather than on the class because the answer is a property of the RUNTIME, not of any
 * particular agent instance: it needs no field, no lock and no session.
 *
 * Kept a module and not a static on the class so `local-agent.ts` carries one fewer concern; the
 * class keeps two one-line delegations, which is the surface `SDKAgent` requires.
 */

import { UnsupportedRunOperationError } from "../../errors.js";
import type { AgentOperation, SDKArtifact } from "../../types/sdk-agent.js";

/** Operations the local runtime has no implementation for. */
const UNSUPPORTED_OPS: ReadonlySet<AgentOperation> = new Set(["downloadArtifact", "listArtifacts"]);

/** Whether the local runtime implements `operation`. */
export function localAgentSupports(operation: AgentOperation): boolean {
  return !UNSUPPORTED_OPS.has(operation);
}

/** Why `operation` is unavailable, or `undefined` when it is available. */
export function localAgentUnsupportedReason(operation: AgentOperation): string | undefined {
  return localAgentSupports(operation)
    ? undefined
    : `Operation "${operation}" is not available on a local agent.`;
}

/** A local agent has no artifacts, so the list is empty rather than an error. */
export function localAgentListArtifacts(): Promise<SDKArtifact[]> {
  return Promise.resolve([]);
}

/**
 * Downloading one IS an error, and a typed one — the asymmetry is deliberate. An empty list is a
 * true answer about a local agent; a download is a request the runtime cannot honour, and
 * `supports("downloadArtifact")` is how a caller finds that out without provoking the rejection.
 */
export function localAgentDownloadArtifact(): Promise<Buffer> {
  return Promise.reject(
    new UnsupportedRunOperationError(
      "Artifacts are not supported for local agents",
      "downloadArtifact",
    ),
  );
}

/**
 * The four answers as one object, so a consumer imports one name.
 *
 * Not decoration: `local-agent.ts` sits against a 400-line budget and a four-name import block costs
 * five lines there. It is also the shape this package already uses for a namespace of related
 * functions — see the static-namespace convention in `tests/lint/static-namespace-names-its-product.test.ts`.
 */
export const localAgentCapabilities = {
  supports: localAgentSupports,
  unsupportedReason: localAgentUnsupportedReason,
  listArtifacts: localAgentListArtifacts,
  downloadArtifact: localAgentDownloadArtifact,
} as const;
