/**
 * Client SDK types (T20.2, ADR D454).
 * @public
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
