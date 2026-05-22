/**
 * Helper to normalize unknown thrown values to `{ name, message }` shape
 * for use in `StepResult.error` / `WorkflowRun.error`.
 *
 * @internal
 */

export function errToShape(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: "Error", message: String(err) };
}
