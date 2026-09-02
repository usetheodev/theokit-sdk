/**
 * Published as `@theokit/sdk/task-store`.
 *
 * Public sub-export for the Task store interface + JSON-backed
 * implementation. Used by `@theokit/cli` to read the registry
 * cross-process from disk (ADR D364 + EC-7 best-effort cancel).
 *
 * @public
 */

export {
  getTaskStoreFor,
  InMemoryTaskStore,
  JsonFileTaskStore,
  type TaskStore,
} from "./internal/task/store.js";
