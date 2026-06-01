/**
 * `useAction` — typed hook for invoking server actions defined via theokit's
 * `defineAction`. Object-return shape (NOT tuple) per plan g3-server-actions-
 * and-useaction v1.2 ADR D2. Lifecycle: `idle → isPending → (success | error)
 *  → idle (after reset)`.
 *
 * Optimistic UI + rollback are OPT-OUT in v1 (per ADR D2). Consumers needing
 * optimistic mutation patterns should wrap useAction in their own state +
 * use the returned `variables` field for the previous-value snapshot.
 *
 * Consumer pattern:
 *   const { data, error, isPending, isError, isSuccess, mutate, reset } =
 *     useAction(createUser)
 *   <button onClick={() => mutate({ name: 'Alice' })}>Create</button>
 *   {isError && <p>{error.message}</p>}
 *   {isSuccess && <p>Created user {data.id}</p>}
 *
 * Type inference: when `action` is the return of `defineAction({input, handler})`,
 * `input` is `z.infer<TInput>` and `data` is `Awaited<ReturnType<handler>>`.
 * The `action` arg can be either:
 *   - A function that takes an input and returns `Promise<TData>` (proxy from
 *     `@theo/actions` virtual module — `actions.createUser(input)`)
 *   - The raw config from `defineAction(...)` (consumer wraps invocation themselves)
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal error shape consumed by `useAction`. Compatible with theokit's
 * `ActionError` / `ActionInputError` (which both have `{code, message,
 * status, [issues, fields]}` surface) but the hook does not import the
 * concrete classes — peer-dep avoidance.
 */
export interface ActionErrorLike {
  code: string;
  message: string;
  status?: number;
  fields?: Record<string, string[]>;
  issues?: unknown[];
  type?: string;
}

export interface UseActionResult<TData, TInput = unknown> {
  data: TData | undefined;
  error: ActionErrorLike | undefined;
  isIdle: boolean;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  variables: TInput | undefined;
  mutate: (input: TInput) => void;
  mutateAsync: (input: TInput) => Promise<TData>;
  reset: () => void;
}

type ActionInvoker<TInput, TData> = (
  input: TInput,
) => Promise<{ data: TData | undefined; error: ActionErrorLike | undefined } | TData>;

type Status = "idle" | "pending" | "success" | "error";

interface State<TData, TInput> {
  status: Status;
  data: TData | undefined;
  error: ActionErrorLike | undefined;
  variables: TInput | undefined;
}

const INITIAL_STATE: State<unknown, unknown> = {
  status: "idle",
  data: undefined,
  error: undefined,
  variables: undefined,
};

export function useAction<TInput = unknown, TData = unknown>(
  action: ActionInvoker<TInput, TData>,
): UseActionResult<TData, TInput> {
  const [state, setState] = useState<State<TData, TInput>>(INITIAL_STATE as State<TData, TInput>);
  // Track latest call to ignore stale results after unmount or re-fire
  const callIdRef = useRef(0);
  const mountedRef = useRef(true);

  // Mount/unmount tracking — guards against setState after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const invoke = useCallback(
    (input: TInput): Promise<TData> => invokeAction(action, input, callIdRef, mountedRef, setState),
    [action],
  );

  const mutate = useCallback(
    (input: TInput) => {
      // Fire-and-forget; swallow rejection so React doesn't surface unhandled-promise warning
      invoke(input).catch(() => undefined);
    },
    [invoke],
  );

  const reset = useCallback(() => {
    callIdRef.current++;
    setState(INITIAL_STATE as State<TData, TInput>);
  }, []);

  return {
    data: state.data,
    error: state.error,
    isIdle: state.status === "idle",
    isPending: state.status === "pending",
    isError: state.status === "error",
    isSuccess: state.status === "success",
    variables: state.variables,
    mutate,
    mutateAsync: invoke,
    reset,
  };
}

async function invokeAction<TInput, TData>(
  action: ActionInvoker<TInput, TData>,
  input: TInput,
  callIdRef: { current: number },
  mountedRef: { current: boolean },
  setState: (state: State<TData, TInput>) => void,
): Promise<TData> {
  const myCallId = ++callIdRef.current;
  setState({ status: "pending", data: undefined, error: undefined, variables: input });
  try {
    const { data, error } = unwrap<TData>(await action(input));
    const isStale = !mountedRef.current || myCallId !== callIdRef.current;
    if (error !== undefined) {
      if (!isStale) {
        setState({ status: "error", data: undefined, error, variables: input });
      }
      throw toError(error);
    }
    if (!isStale) {
      setState({ status: "success", data, error: undefined, variables: input });
    }
    return data as TData;
  } catch (err) {
    if (mountedRef.current && myCallId === callIdRef.current) {
      const wrapped = normalizeError(err);
      setState({ status: "error", data: undefined, error: wrapped, variables: input });
    }
    throw err;
  }
}

function unwrap<TData>(
  raw: { data: TData | undefined; error: ActionErrorLike | undefined } | TData,
): { data: TData | undefined; error: ActionErrorLike | undefined } {
  if (raw && typeof raw === "object" && "data" in raw && "error" in raw) {
    return raw as { data: TData | undefined; error: ActionErrorLike | undefined };
  }
  return { data: raw as TData, error: undefined };
}

function normalizeError(err: unknown): ActionErrorLike {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    return err as ActionErrorLike;
  }
  return {
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}

function toError(err: ActionErrorLike): Error {
  const wrapped = new Error(err.message);
  Object.assign(wrapped, err);
  return wrapped;
}

// Exposed for unit tests — these are pure helpers that drive the hook's
// lifecycle. Full renderHook coverage is deferred to dogfood-app E2E.
export const __testInternals = {
  unwrap,
  normalizeError,
  toError,
  INITIAL_STATE,
} as const;
