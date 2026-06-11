import { describe, expect, it, vi } from "vitest";
import { generateTitle } from "../../src/session/summary.js";

describe("generateTitle", () => {
  it("calls LLM with conversation context", async () => {
    const callLlm = vi.fn().mockResolvedValue("Fix auth bug");

    await generateTitle(
      [
        { role: "user", content: "The login page is broken" },
        { role: "assistant", content: "I'll look into the auth module" },
      ],
      callLlm,
    );

    expect(callLlm).toHaveBeenCalledOnce();
    const [, user] = callLlm.mock.calls[0]!;
    expect(user).toContain("login page is broken");
  });

  it("returns the title string from LLM", async () => {
    const callLlm = vi.fn().mockResolvedValue("Debug authentication flow");

    const title = await generateTitle([{ role: "user", content: "Help me fix login" }], callLlm);

    expect(title).toBe("Debug authentication flow");
  });

  it("returns fallback on empty messages", async () => {
    const callLlm = vi.fn();

    const title = await generateTitle([], callLlm);

    expect(title).toBe("Untitled Session");
    expect(callLlm).not.toHaveBeenCalled();
  });

  it("returns fallback on LLM error", async () => {
    const callLlm = vi.fn().mockRejectedValue(new Error("LLM down"));

    const title = await generateTitle([{ role: "user", content: "test" }], callLlm);

    expect(title).toBe("Untitled Session");
  });
});
