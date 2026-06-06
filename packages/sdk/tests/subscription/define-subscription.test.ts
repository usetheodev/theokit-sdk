/**
 * G8 T2.1 — defineSubscription DSL.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSubscription } from "../../src/subscription/define-subscription.js";

describe("defineSubscription", () => {
  it("returns a descriptor with input/output/handler", () => {
    const input = z.object({ topic: z.string() });
    const output = z.object({ msg: z.string() });
    const desc = defineSubscription({
      input,
      output,
      // biome-ignore lint/correctness/useYield: intentional empty handler — test asserts registration only
      async *handler() {
        return;
      },
    });
    expect(desc.input).toBe(input);
    expect(desc.output).toBe(output);
    expect(typeof desc.handler).toBe("function");
  });

  it("preserves explicit name", () => {
    const desc = defineSubscription({
      name: "chat-room",
      input: z.object({}),
      output: z.object({}),
      // biome-ignore lint/correctness/useYield: intentional empty handler — test asserts name preservation only
      async *handler() {
        return;
      },
    });
    expect(desc.name).toBe("chat-room");
  });

  it("throws when input is missing", () => {
    expect(() =>
      defineSubscription({
        // @ts-expect-error testing runtime guard
        input: undefined,
        output: z.object({}),
        // biome-ignore lint/correctness/useYield: handler only reached if runtime guard fails
        async *handler() {
          return;
        },
      }),
    ).toThrow(TypeError);
  });

  it("throws when output is missing", () => {
    expect(() =>
      defineSubscription({
        input: z.object({}),
        // @ts-expect-error testing runtime guard
        output: undefined,
        // biome-ignore lint/correctness/useYield: handler only reached if runtime guard fails
        async *handler() {
          return;
        },
      }),
    ).toThrow(TypeError);
  });

  it("throws when handler is missing", () => {
    expect(() =>
      defineSubscription({
        input: z.object({}),
        output: z.object({}),
        // @ts-expect-error testing runtime guard
        handler: undefined,
      }),
    ).toThrow(TypeError);
  });
});
