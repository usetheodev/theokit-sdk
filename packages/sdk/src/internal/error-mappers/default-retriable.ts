/**
 * Default retryability verdict for an `AgentRunError` code.
 *
 * Extracted from `errors.ts` (G8 LoC budget — SRP). The parameter is typed
 * `string` (not the `AgentRunErrorCode` union) deliberately: this is a leaf
 * with NO import back into `errors.ts`, so it cannot form an import cycle. The
 * `default` branch makes the behavior identical to the typed switch.
 *
 * @internal
 */
export function defaultRetriableForCode(code: string): boolean {
  switch (code) {
    case "rate_limit":
    case "timeout":
    case "server_error":
    case "network":
    case "provider_unreachable":
      return true;
    default:
      return false;
  }
}
