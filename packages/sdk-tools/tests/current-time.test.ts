import { describe, expect, it } from "vitest";

import { createCurrentTimeTool } from "../src/current-time.js";
import { textHandler } from "./text-handler.js";

// Fixed instant so the tool is deterministic (testing.md §6: never read the real clock in a unit test).
const FIXED = () => new Date("2026-07-20T19:45:03.000Z");

describe("current_time built-in", () => {
  it("defaults to UTC in the Codex format (YYYY-MM-DD HH:MM:SS UTC) + ISO", async () => {
    const tool = createCurrentTimeTool({ clock: FIXED });
    const r = JSON.parse(await textHandler(tool)({}));
    expect(r).toEqual({
      ok: true,
      current_time: "2026-07-20 19:45:03 UTC",
      iso: "2026-07-20T19:45:03.000Z",
      timezone: "UTC",
    });
  });

  it("honors an IANA timezone (America/Sao_Paulo is UTC-3)", async () => {
    const tool = createCurrentTimeTool({ clock: FIXED });
    const r = JSON.parse(await textHandler(tool)({ timezone: "America/Sao_Paulo" }));
    expect(r.ok).toBe(true);
    expect(r.current_time).toBe("2026-07-20 16:45:03 America/Sao_Paulo");
    expect(r.iso).toBe("2026-07-20T19:45:03.000Z"); // the instant is timezone-independent
    expect(r.timezone).toBe("America/Sao_Paulo");
  });

  it("returns a typed error (not a throw) for an invalid timezone — fail-clear", async () => {
    const tool = createCurrentTimeTool({ clock: FIXED });
    const r = JSON.parse(await textHandler(tool)({ timezone: "Not/Real" }));
    expect(r).toEqual({ ok: false, error: "invalid_timezone", timezone: "Not/Real" });
  });

  it("defaults the clock to the real wall time when none is injected (shape only)", async () => {
    const tool = createCurrentTimeTool();
    const r = JSON.parse(await textHandler(tool)({}));
    expect(r.ok).toBe(true);
    expect(r.current_time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
    expect(r.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
