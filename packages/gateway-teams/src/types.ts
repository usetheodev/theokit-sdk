/**
 * Public option types for `@usetheo/gateway-teams` (ADRs D315-D326).
 *
 * @public
 */

/** Sentinel runtime export — workaround for rollup-plugin-dts deep type-only re-export bug. */
export const __teamsTypesMarker: unique symbol = Symbol("teams-types");

/** Adapter options. */
export interface TeamsAdapterOptions {
  /** Azure AD application client id. */
  readonly clientId: string;
  /** Azure AD application client secret. */
  readonly clientSecret: string;
  /** Azure AD tenant id. */
  readonly tenantId: string;
  /** Optional bot display name used as a fallback for mention stripping. */
  readonly botDisplayName?: string;
  /**
   * Pluggable HTTP server adapter — typically `new ExpressAdapter(yourExpressApp)`
   * from `@microsoft/teams.apps`. When provided, the SDK registers
   * `POST /api/messages` on your existing server (ADR D316/D326).
   */
  readonly httpServerAdapter?: unknown;
  /** Test seam — inject a fake App instance. @internal */
  readonly __appFactory?: (opts: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    httpServerAdapter?: unknown;
  }) => unknown;
}
