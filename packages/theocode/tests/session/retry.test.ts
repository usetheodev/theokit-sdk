import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "../../src/session/retry.js";

describe("retryWithBackoff", () => {
  it("succeeds on first attempt without delay", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxAttempts: 3 });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("succeeds on second attempt after one failure", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 1, // fast for tests
    });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    await expect(retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(
      "always fails",
    );

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses exponential backoff delays", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      return originalSetTimeout(fn, 0); // execute immediately
    }) as typeof setTimeout);

    const fnMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"))
      .mockResolvedValue("ok");

    await retryWithBackoff(fnMock, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 30000,
    });

    // Delays should be 100, 200, 400 (exponential)
    expect(delays).toEqual([100, 200, 400]);
    vi.restoreAllMocks();
  });

  it("respects retryAfterMs on error", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout);

    const error = Object.assign(new Error("rate limited"), {
      retryAfterMs: 5000,
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");

    await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 100,
    });

    expect(delays[0]).toBe(5000);
    vi.restoreAllMocks();
  });

  it("throws immediately for non-retryable errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        isRetryable: () => false,
      }),
    ).rejects.toThrow("fatal");

    expect(fn).toHaveBeenCalledOnce();
  });

  it("EC-3: throws immediately when maxAttempts < 1", async () => {
    const fn = vi.fn();

    await expect(retryWithBackoff(fn, { maxAttempts: 0 })).rejects.toThrow(
      "maxAttempts must be >= 1",
    );

    expect(fn).not.toHaveBeenCalled();
  });
});
