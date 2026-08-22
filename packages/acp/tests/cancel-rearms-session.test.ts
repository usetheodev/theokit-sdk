import type * as acp from "@agentclientprotocol/sdk";
import type { Run, SDKAgent } from "@theokit/sdk";
import { beforeEach, expect, it, vi } from "vitest";

const translateStream = vi.fn(async () => undefined);
const installPermissionPlugin = vi.fn(async () => undefined);
vi.mock("../src/translator.js", () => ({
  translateStream: (...args: unknown[]) => translateStream(...(args as [])),
}));
vi.mock("../src/permission-plugin.js", () => ({
  installPermissionPlugin: (...args: unknown[]) => installPermissionPlugin(...(args as [])),
}));

import { handleCancel } from "../src/lifecycle.js";
import { handlePrompt } from "../src/prompt-handler.js";
import { type AcpSession, SessionStore } from "../src/session-store.js";

/*
 * #349 — `session/cancel` permanently killed the session.
 *
 * The session owned exactly one `AbortController`, created at session creation and never replaced,
 * so cancelling one turn handed every LATER turn on that session an already-aborted signal. ACP
 * hosts routinely cancel a turn (Escape / "stop") and then prompt again on the same session: from
 * the user's seat the agent simply stopped answering, with the host still connected and the
 * session still listed.
 *
 * An abort scope belongs to the turn, not to the session — the session outlives it by design.
 */

const SESSION_ID = "sess-1";

function harness() {
  const signals: AbortSignal[] = [];
  const run = {
    stream: () => (async function* () {})(),
    wait: async () => ({ status: "finished" }),
  } as unknown as Run;
  const send = vi.fn(async (_text: string, opts?: { signal?: AbortSignal }) => {
    if (opts?.signal !== undefined) signals.push(opts.signal);
    return run;
  });
  const session: AcpSession = {
    sessionId: SESSION_ID,
    agent: { agentId: "a-1", send } as unknown as SDKAgent,
    createdAt: 0,
    lastUsedAt: 0,
    abortController: new AbortController(),
    cwd: "/tmp",
  };
  const store = new SessionStore();
  store.create(session);
  const deps = {
    store,
    conn: {} as acp.AgentSideConnection,
    maxPromptBytes: 1024,
    permissionMode: "auto" as const,
    permissionTimeoutMs: 1000,
    trustedTools: new Set<string>(),
    log: vi.fn(),
  };
  const prompt = (text: string): acp.PromptRequest =>
    ({ sessionId: SESSION_ID, prompt: [{ type: "text", text }] }) as unknown as acp.PromptRequest;
  return { store, session, deps, prompt, signals };
}

beforeEach(() => {
  vi.clearAllMocks();
  translateStream.mockImplementation(async () => undefined);
  installPermissionPlugin.mockImplementation(async () => undefined);
});

it("answers a prompt sent after a cancel", async () => {
  const { session, deps, prompt, signals } = harness();

  await handlePrompt(prompt("first"), deps);
  handleCancel({ sessionId: SESSION_ID } as acp.CancelNotification, { store: deps.store });
  await handlePrompt(prompt("second"), deps);

  expect(signals).toHaveLength(2);
  expect(signals[1]?.aborted, "the turn after a cancel must start un-aborted").toBe(false);
  expect(session.sessionId).toBe(SESSION_ID);
});

it("still cancels the turn that is in flight", async () => {
  // The accepted case (`testing.md` § 4.2). Re-arming per turn must not make `session/cancel` a
  // no-op — that would trade one broken behaviour for the opposite one.
  const { deps, prompt, signals } = harness();
  translateStream.mockImplementation(async () => {
    handleCancel({ sessionId: SESSION_ID } as acp.CancelNotification, { store: deps.store });
  });

  await handlePrompt(prompt("first"), deps);

  expect(signals[0]?.aborted).toBe(true);
});

it("cancels only the session it names", async () => {
  const { deps, prompt, signals } = harness();

  handleCancel({ sessionId: "some-other-session" } as acp.CancelNotification, {
    store: deps.store,
  });
  await handlePrompt(prompt("first"), deps);

  expect(signals[0]?.aborted).toBe(false);
});
