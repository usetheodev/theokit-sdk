/**
 * Client SDK types (T20.2, ADR D454).
 * @public
 * @deprecated since 2.x — types for the deprecated `@theokit/sdk/client`
 * (`TheoKitClient`) sub-path; removed with it in the next major.
 */

export interface ClientOptions {
  baseUrl: string;
  basePath?: string;
  headers?: Record<string, string>;
}

export interface SendResponse {
  status: string;
  output?: unknown;
  error?: string;
}

export interface StreamEvent {
  type: string;
  text?: string;
  [key: string]: unknown;
}
