import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendMemoryFact,
  extractMemoryFact,
  extractMemoryKind,
} from "../../src/internal/runtime/memory-glue/memory-store.js";

describe("extractMemoryKind — #401", () => {
  it("test_a_declared_kind_is_read_off_the_remember_prompt", () => {
    expect(extractMemoryKind("Remember (feedback): prefer tabs")).toBe("feedback");
  });

  it("test_every_kind_the_store_accepts_can_be_declared", () => {
    for (const kind of ["user", "feedback", "project", "reference"]) {
      expect(extractMemoryKind(`Remember (${kind}): something`)).toBe(kind);
    }
  });

  it("test_a_prompt_with_no_parenthetical_leaves_the_fact_untyped", () => {
    expect(extractMemoryKind("Remember: prefer tabs")).toBeUndefined();
  });

  // Only the four kinds the store accepts are recognised, so an arbitrary parenthetical is never
  // mistaken for one — no fact is silently typed wrong.
  //
  // Such a prompt matches nothing and writes no memory, which is what it already did before #401:
  // `Remember` had to be followed by `:`. This test pins that as UNCHANGED rather than claiming an
  // improvement — widening the prompt is a separate decision from making `kind` writable.
  it("test_a_parenthetical_that_is_not_a_kind_is_never_mistaken_for_one", () => {
    expect(extractMemoryKind("Remember (my boss said): ship on friday")).toBeUndefined();
    expect(extractMemoryFact("Remember (my boss said): ship on friday")).toBe("");
  });

  it("test_declaring_a_kind_does_not_leave_it_inside_the_fact_text", () => {
    expect(extractMemoryFact("Remember (feedback): prefer tabs")).toBe("prefer tabs");
  });
});

describe("appendMemoryFact — #401", () => {
  it("test_a_declared_kind_survives_to_disk_instead_of_being_dropped_at_the_write", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "memory-kind-"));
    await appendMemoryFact(cwd, { enabled: true }, { text: "prefer tabs", kind: "feedback" });

    const dir = join(cwd, ".theokit", "memory");
    const file = readdirSync(dir).find((f) => f !== "MEMORY.md");
    expect(file).toBeDefined();
    expect(readFileSync(join(dir, file as string), "utf8")).toContain("type: feedback");
  });

  it("test_a_fact_with_no_kind_is_still_written_untyped", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "memory-kind-"));
    await appendMemoryFact(cwd, { enabled: true }, { text: "prefer tabs" });
    const dir = join(cwd, ".theokit", "memory");
    const file = readdirSync(dir).find((f) => f !== "MEMORY.md");
    expect(readFileSync(join(dir, file as string), "utf8")).toContain("prefer tabs");
  });
});
