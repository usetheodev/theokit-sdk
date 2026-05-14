import { expect } from "vitest";

import { TheokitAgentError } from "../../src/index.js";

type ErrorCtor<T extends Error = Error> = new (...args: any[]) => T;

export interface PublicErrorShape {
  ctor: ErrorCtor;
  name: string;
  code?: string;
  isRetryable?: boolean;
  protoErrorCode?: string;
  message?: RegExp;
  cause?: unknown;
  extra?: Record<string, unknown>;
}

export function expectPublicError(error: unknown, shape: PublicErrorShape): asserts error is Error {
  expect(error).toBeInstanceOf(shape.ctor);
  expect(error).toBeInstanceOf(TheokitAgentError);
  expect(error).toMatchObject({
    name: shape.name,
    message: shape.message ?? expect.any(String),
    isRetryable: shape.isRetryable ?? expect.any(Boolean),
  });

  if (shape.code !== undefined) expect((error as { code?: string }).code).toBe(shape.code);
  if (shape.protoErrorCode !== undefined) {
    expect((error as { protoErrorCode?: string }).protoErrorCode).toBe(shape.protoErrorCode);
  }
  if (shape.cause !== undefined) expect((error as { cause?: unknown }).cause).toBe(shape.cause);
  if (shape.extra) expect(error).toMatchObject(shape.extra);
}
