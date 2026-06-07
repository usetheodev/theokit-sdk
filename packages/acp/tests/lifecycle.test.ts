/**
 * T2.2 + T2.3 — lifecycle handler tests.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ACP_ERR,
  buildInitializeResponse,
  handleCancel,
  handleForkSession,
  handleListSessions,
  handleLoadSession,
  handleNewSession,
} from "../src/lifecycle.js";
import { type AcpSession, SessionStore } from "../src/session-store.js";
import { makeFakeAgent } from "./helpers.js";

const noopLog = (): void => undefined;

describe("buildInitializeResponse", () => {
  it("initialize_returns_correct_protocol_version", () => {
    const res = buildInitializeResponse({ protocolVersion: 1 } as never, {});
    expect(res.protocolVersion).toBeTypeOf("number");
    expect(res.protocolVersion).toBeGreaterThan(0);
  });

  it("initialize_merges_user_capabilities_over_defaults", () => {
    const res = buildInitializeResponse({ protocolVersion: 1 } as never, {
      capabilities: { loadSession: false, prompt: { image: false } },
    });
    expect(res.agentCapabilities?.loadSession).toBe(false);
    expect(res.agentCapabilities?.promptCapabilities?.image).toBe(false);
    // default kept
    expect(res.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
  });

  it("initialize_idempotent_second_call_returns_same_response (SHOULD TEST EC-11)", () => {
    const params = { protocolVersion: 1 } as never;
    const a = buildInitializeResponse(params, {});
    const b = buildInitializeResponse(params, {});
    expect(a).toEqual(b);
  });
});

describe("handleNewSession (T2.2)", () => {
  it("new_session_creates_agent_and_stores", async () => {
    const store = new SessionStore();
    const agent = makeFakeAgent();
    const factory = vi.fn().mockResolvedValue(agent);
    const tmp = mkdtempSync(join(tmpdir(), "acp-cwd-"));
    try {
      const r = await handleNewSession({ cwd: tmp } as never, { factory, store, log: noopLog });
      expect("response" in r).toBe(true);
      if ("response" in r) {
        expect(r.response.sessionId).toBeTypeOf("string");
        expect(store.has(r.response.sessionId)).toBe(true);
      }
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("new_session_factory_throw_propagates_as_error", async () => {
    const store = new SessionStore();
    const factory = vi.fn().mockRejectedValue(new Error("boom"));
    const tmp = mkdtempSync(join(tmpdir(), "acp-cwd-"));
    try {
      const r = await handleNewSession({ cwd: tmp } as never, { factory, store, log: noopLog });
      expect("error" in r).toBe(true);
      if ("error" in r) {
        expect(r.error.code).toBe(ACP_ERR.INTERNAL_ERROR);
        expect(r.error.message).toMatch(/boom/);
      }
      expect(store.size()).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("new_session_validates_cwd_exists", async () => {
    const store = new SessionStore();
    const factory = vi.fn();
    const r = await handleNewSession({ cwd: "/definitely/does/not/exist" } as never, {
      factory,
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_REQUEST);
      expect(r.error.message).toMatch(/cwd not found/);
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("new_session_resolves_relative_cwd_to_absolute (EC-5)", async () => {
    const store = new SessionStore();
    const factory = vi.fn().mockResolvedValue(makeFakeAgent());
    // Use "." which resolves to process.cwd() and surely exists.
    const r = await handleNewSession({ cwd: "." } as never, { factory, store, log: noopLog });
    expect("response" in r).toBe(true);
    // After: store has a session with absolute cwd
    if ("response" in r) {
      const session = store.get(r.response.sessionId);
      expect(session?.cwd).toBe(process.cwd());
    }
  });

  it("new_session_unresolvable_cwd_returns_invalid_request (EC-5)", async () => {
    const store = new SessionStore();
    const factory = vi.fn();
    const r = await handleNewSession({ cwd: "./totally-not-here" } as never, {
      factory,
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_REQUEST);
    }
  });
});

describe("handleCancel (T2.2)", () => {
  it("cancel_aborts_lifecycle_controller", () => {
    const store = new SessionStore();
    const session: AcpSession = {
      sessionId: "s-1",
      agent: makeFakeAgent(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      abortController: new AbortController(),
      cwd: "/tmp",
    };
    store.create(session);
    expect(session.abortController.signal.aborted).toBe(false);
    handleCancel({ sessionId: "s-1" } as never, { store });
    expect(session.abortController.signal.aborted).toBe(true);
  });

  it("cancel_unknown_session_id_no_op", () => {
    const store = new SessionStore();
    expect(() => handleCancel({ sessionId: "unknown" } as never, { store })).not.toThrow();
  });

  it("cancel_twice_idempotent", () => {
    const store = new SessionStore();
    const session: AcpSession = {
      sessionId: "s-1",
      agent: makeFakeAgent(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      abortController: new AbortController(),
      cwd: "/tmp",
    };
    store.create(session);
    handleCancel({ sessionId: "s-1" } as never, { store });
    expect(() => handleCancel({ sessionId: "s-1" } as never, { store })).not.toThrow();
  });
});

describe("handleListSessions", () => {
  it("returns snapshot with sessionId + cwd", () => {
    const store = new SessionStore();
    const session: AcpSession = {
      sessionId: "s-1",
      agent: makeFakeAgent(),
      createdAt: 1,
      lastUsedAt: 2,
      abortController: new AbortController(),
      cwd: "/tmp",
    };
    store.create(session);
    const res = handleListSessions({} as never, store);
    expect(res.sessions).toHaveLength(1);
    expect(res.sessions[0]?.sessionId).toBe("s-1");
    expect(res.sessions[0]?.cwd).toBe("/tmp");
  });
});

describe("handleForkSession (T2.3, EC-3)", () => {
  it("fork_session_unknown_parent_returns_invalid_session", async () => {
    const store = new SessionStore();
    const r = await handleForkSession({ sessionId: "ghost", cwd: process.cwd() } as never, {
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_SESSION);
    }
  });

  it("fork_session_v01_returns_invalid_request_deferred", async () => {
    // v0.1: forkSession is deferred to v0.2. Parent exists but op rejects cleanly.
    const store = new SessionStore();
    const session: AcpSession = {
      sessionId: "parent",
      agent: makeFakeAgent(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      abortController: new AbortController(),
      cwd: process.cwd(),
    };
    store.create(session);
    const r = await handleForkSession({ sessionId: "parent", cwd: process.cwd() } as never, {
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_REQUEST);
      expect(r.error.message).toMatch(/deferred/);
    }
  });
});

describe("handleLoadSession (T2.3, EC-6)", () => {
  it("load_session_invalid_cwd_returns_invalid_request (EC-5)", async () => {
    const store = new SessionStore();
    const r = await handleLoadSession({ sessionId: "s-1", cwd: "./nope/nope" } as never, {
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_REQUEST);
    }
  });

  it("load_session_duplicate_rejects", async () => {
    const store = new SessionStore();
    const session: AcpSession = {
      sessionId: "s-1",
      agent: makeFakeAgent(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      abortController: new AbortController(),
      cwd: process.cwd(),
    };
    store.create(session);
    const r = await handleLoadSession({ sessionId: "s-1", cwd: process.cwd() } as never, {
      store,
      log: noopLog,
    });
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_REQUEST);
      expect(r.error.message).toMatch(/already loaded/);
    }
  });

  it("load_session_unknown_agent_returns_invalid_session_with_storage_hint (EC-6)", async () => {
    const store = new SessionStore();
    // Agent.resume will throw because agentId doesn't exist anywhere.
    const r = await handleLoadSession(
      { sessionId: "nonexistent-uuid-xyz", cwd: process.cwd() } as never,
      { store, log: noopLog },
    );
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error.code).toBe(ACP_ERR.INVALID_SESSION);
      expect(r.error.message).toMatch(/session not found/);
      expect(r.error.message).toMatch(/conversationStorage|docs\/recipes/);
    }
  });
});
