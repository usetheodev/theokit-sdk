/**
 * `MemoryProvider` port + companion contract types.
 *
 * The contract now lives in the domain `types/` layer (SE46 DIP direction):
 * `types/memory-provider.ts` owns the port + companions; this application-layer
 * module re-exports them so existing importers (agent-loop, local-agent glue,
 * index.ts) keep resolving the same names.
 *
 * @public — surface-level interface; impls are internal-but-replaceable.
 */

export type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderAgentRef,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  RecordSessionSummaryArgs,
} from "../../../types/memory-provider.js";
