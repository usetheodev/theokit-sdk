/**
 * Typed errors for `@usetheo/gateway-sms` (D389-D396).
 *
 * - `ConfigurationError` — programmer error at construction time
 *   (missing signing secret, missing backend SDK install, malformed
 *   phone number on outbound). Thrown synchronously.
 * - `BackendNotInstalledError` — peer-dep optional backend (twilio /
 *   plivo / @vonage/server-sdk) was selected but the npm package is
 *   not installed. Carries actionable install hint.
 *
 * Both extend the SDK's base error hierarchy through standard Error
 * (the SDK consumes structured errors via metadata.code).
 *
 * @internal — re-exported by `src/index.ts`.
 */

export interface ConfigurationErrorOptions {
  readonly message?: string;
  readonly code: string;
  readonly detail?: string;
}

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  readonly code: string;
  readonly detail: string | undefined;
  constructor(opts: ConfigurationErrorOptions) {
    super(opts.message ?? `gateway-sms: ${opts.code}`);
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export class BackendNotInstalledError extends ConfigurationError {
  constructor(backend: "twilio" | "plivo" | "vonage", pkgName: string) {
    super({
      code: "backend_not_installed",
      message: `gateway-sms: peer-dep "${pkgName}" not installed but backend="${backend}" was selected. Run: pnpm add ${pkgName}`,
      detail: pkgName,
    });
  }
}
