/**
 * Typed errors for `@usetheo/gateway-matrix`.
 */

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
    super(opts.message ?? `gateway-matrix: ${opts.code}`);
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

export class SDKNotInstalledError extends ConfigurationError {
  constructor() {
    super({
      code: "sdk_not_installed",
      message:
        'gateway-matrix: peer-dep "matrix-js-sdk" not installed. Run: pnpm add matrix-js-sdk',
      detail: "matrix-js-sdk",
    });
  }
}

export class EncryptedRoomError extends ConfigurationError {
  constructor(roomId: string) {
    super({
      code: "encrypted_room_unsupported",
      message: `gateway-matrix: room ${roomId} is end-to-end encrypted (E2EE deferred to v0.2)`,
      detail: roomId,
    });
  }
}
