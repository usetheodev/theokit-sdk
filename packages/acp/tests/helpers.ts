import type { SDKAgent } from "@theokit/sdk";
import { vi } from "vitest";

export const makeFakeAgent = (overrides: Partial<SDKAgent> = {}): SDKAgent =>
  ({
    agentId: "a-1",
    model: undefined,
    send: vi.fn(),
    close: vi.fn(),
    reload: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(),
    ...overrides,
  }) as unknown as SDKAgent;
