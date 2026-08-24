import { describe, expect, it, vi } from "vitest";
import { createEventLog, LiveEventLog } from "../../src/internal/agent-loop/live-events.js";
import type { SDKMessage } from "../../src/types/messages.js";

/**
 * theokit#140 — the loop's event log reports each event AS IT HAPPENS.
 *
 * The class is a deliberate `Array` subclass, which is the risky part: `map`,
 * `filter` and `slice` re-instantiate the subclass with a LENGTH argument, and
 * `AgentLoopOutput.events` is still typed `SDKMessage[]`. So the tests below
 * assert two things at once — the live delivery it adds, and the plain-array
 * behaviour it must not break.
 */
const msg = (id: string): SDKMessage => ({ type: "assistant", text: id }) as unknown as SDKMessage;

describe("LiveEventLog — live delivery", () => {
  it("notifies the subscriber for each pushed event, in order", () => {
    const seen: SDKMessage[] = [];
    const log = new LiveEventLog();
    log.subscribe((e) => seen.push(e));

    log.push(msg("a"), msg("b"));
    log.push(msg("c"));

    expect(seen).toEqual([msg("a"), msg("b"), msg("c")]);
  });

  it("still records events pushed before any subscriber attached", () => {
    const log = new LiveEventLog();

    log.push(msg("early"));
    const seen: SDKMessage[] = [];
    log.subscribe((e) => seen.push(e));
    log.push(msg("late"));

    // The batch path (`AgentLoopOutput.events`) must carry both; only the live
    // path starts at subscription.
    expect([...log]).toEqual([msg("early"), msg("late")]);
    expect(seen).toEqual([msg("late")]);
  });

  it("delivers to the latest subscriber after resubscription", () => {
    const first: SDKMessage[] = [];
    const second: SDKMessage[] = [];
    const log = new LiveEventLog();

    log.subscribe((e) => first.push(e));
    log.subscribe((e) => second.push(e));
    log.push(msg("x"));

    expect(first).toEqual([]);
    expect(second).toEqual([msg("x")]);
  });

  it("returns the new length from push, like a plain array", () => {
    const log = new LiveEventLog();

    expect(log.push(msg("a"))).toBe(1);
    expect(log.push(msg("b"), msg("c"))).toBe(3);
  });
});

describe("LiveEventLog — a throwing subscriber must not kill the run", () => {
  it("keeps the event in the array when the sink throws", () => {
    const log = new LiveEventLog();
    log.subscribe(() => {
      throw new Error("the UI blew up");
    });

    expect(() => log.push(msg("a"))).not.toThrow();
    // This is the contract that matters: a broken observer loses its live
    // delivery, never the agent's own record of what happened.
    expect([...log]).toEqual([msg("a")]);
  });

  it("still delivers the remaining events of the same push after one throws", () => {
    const seen: SDKMessage[] = [];
    const log = new LiveEventLog();
    let calls = 0;
    log.subscribe((e) => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      seen.push(e);
    });

    log.push(msg("a"), msg("b"));

    expect(seen).toEqual([msg("b")]);
    expect([...log]).toEqual([msg("a"), msg("b")]);
  });
});

describe("LiveEventLog — remains a real Array", () => {
  it("is an Array instance so downstream consumers are unaffected", () => {
    const log = new LiveEventLog();
    log.push(msg("a"));

    expect(Array.isArray(log)).toBe(true);
    expect(log).toBeInstanceOf(Array);
    expect(log.length).toBe(1);
  });

  it("survives map/filter/slice, which re-instantiate the subclass with a length", () => {
    const log = createEventLog([msg("a"), msg("b"), msg("c")]);

    // The documented hazard: `Array` subclasses are re-created by these methods
    // with a numeric length argument. A constructor taking a sink would break here.
    expect(() => log.slice(1)).not.toThrow();
    expect(log.slice(1)).toHaveLength(2);
    expect(log.filter((_, i) => i === 0)).toHaveLength(1);
    expect(log.map((m) => m)).toHaveLength(3);
  });

  it("does not notify the sink for events produced by map/filter/slice", () => {
    const sink = vi.fn();
    const log = createEventLog([msg("a"), msg("b")]);
    log.subscribe(sink);

    log.slice(0);
    log.filter(() => true);

    expect(sink).not.toHaveBeenCalled();
  });
});

describe("createEventLog", () => {
  it("seeds the log with the events that existed before the loop started", () => {
    const log = createEventLog([msg("a"), msg("b")]);

    expect([...log]).toEqual([msg("a"), msg("b")]);
    expect(log.length).toBe(2);
  });

  it("produces an empty log from an empty seed", () => {
    const log = createEventLog([]);

    expect(log.length).toBe(0);
    expect([...log]).toEqual([]);
  });

  it("seeds a single event as a one-element log", () => {
    // Deliberately NOT named for the Array-length hazard the source comment
    // describes. That hazard needs a single NUMERIC argument, and `seed` is
    // `readonly SDKMessage[]` — an object array — so spreading into the
    // constructor produces an identical log and no test can tell the two apart.
    // The guard is right; TypeScript already makes it unreachable.
    const log = createEventLog([msg("only")]);

    expect(log.length).toBe(1);
    expect(log[0]).toEqual(msg("only"));
  });

  it("returns a LiveEventLog that is already subscribable", () => {
    const seen: SDKMessage[] = [];
    const log = createEventLog([msg("seed")]);
    log.subscribe((e) => seen.push(e));

    log.push(msg("after"));

    expect(seen).toEqual([msg("after")]);
  });
});
