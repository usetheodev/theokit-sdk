/**
 * Typed errors for `@theokit/gateway-line`.
 */

/** @knipignore — public input shape for `ConfigurationError` constructor (caller-extensible). */
export interface ConfigurationErrorOptions {
  readonly code: string;
  readonly message?: string;
  readonly detail?: string;
}

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
  readonly code: string;
  readonly detail: string | undefined;
  constructor(opts: ConfigurationErrorOptions) {
    super(opts.message ?? `gateway-line: ${opts.code}`);
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export class SDKNotInstalledError extends ConfigurationError {
  constructor(pkgName: string) {
    super({
      code: "sdk_not_installed",
      message: `gateway-line: peer-dep "${pkgName}" not installed. Run: pnpm add ${pkgName}`,
      detail: pkgName,
    });
  }
}
