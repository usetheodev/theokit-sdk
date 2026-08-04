/**
 * M107 T1.1 — `exclusive?: true` makes the temp file born by EXCLUSIVE creation (`wx`).
 *
 * ## The seam, and why it is mandatory (EC-4 of `/edge-case-plan`)
 *
 * The test the plan asked for — *"pre-plant the temp file and assert the write rejects"* — is
 * **unwritable as specified**. The temp file's name is
 * `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
 * (`src/internal/persistence/atomic-write.ts:106-107`): 64 bits de CSPRNG, exatamente o que o T5.7
 * introduced precisely so nobody — neither an attacker nor this test — can predict the path.
 *
 * The seam is therefore **`vi.mock("node:crypto")`**, making `randomBytes` deterministic only inside
 * this file. It lives in a separate file on purpose: `vi.mock` replaces the module for the whole
 * test file's graph, and contaminating `atomic-write-json.test.ts` — which asserts precisely the
 * production behavior — it would trade an oracle for a scenario.
 *
 * No seam was opened in PRODUCTION code: the suffix generator is still the real `node:crypto`
 * at runtime. Injecting it as a parameter to ease testing would add surface
 * nobody asked for (rung 5 of `.claude/rules/parsimony-ladder.md`).
 *
 * ## Mutation counter-proof (executed; output in the iteration log)
 *
 * | Mutation in `atomic-write.ts` | Tests that die |
 * |---|---|
 * | `const flag = options?.exclusive === true ? "wx" : "w"` -> `const flag = "w"` | `test_exclusive_fails_when_the_temp_file_already_exists` |
 *
 * The test pair is what gives the mutation meaning: without `exclusive`, a leftover temp file **is**
 * truncated (today's behavior, preserved); with `exclusive`, it is a refusal. A test of only the
 * `true` branch would also pass under the inverse mutation (`flag = "wx"` always), which would break every
 * chamador atual.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, randomBytes: (n: number) => Buffer.alloc(n, 0xab) };
});

import { atomicWriteJson } from "../../../src/internal/persistence/atomic-write.js";

/** The temp path production will choose, given the deterministic `randomBytes` above. */
function tempPathFor(destination: string): string {
  return `${destination}.${process.pid}.${Buffer.alloc(8, 0xab).toString("hex")}.tmp`;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m107-exclusive-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("M107 T1.1 — exclusive makes the temp file born by exclusive creation", () => {
  it("test_exclusive_fails_when_the_temp_file_already_exists", async () => {
    // Arrange — the temp file production would choose is already on disk (residue of an interrupted
    // write, or planted). The destination has prior content that must not be lost.
    const destination = join(dir, "config.json");
    writeFileSync(destination, '{\n  "previous": true\n}\n');
    writeFileSync(tempPathFor(destination), "residue");

    // Act + Assert — exclusive creation refuses with the SYSTEM's error, not silenced.
    await expect(atomicWriteJson(destination, { novo: true }, { exclusive: true })).rejects.toThrow(
      /EEXIST/,
    );

    // Assert — the destination was NOT touched, nor was the residue (the refusal happens at creation).
    expect(readFileSync(destination, "utf-8")).toBe('{\n  "previous": true\n}\n');
    expect(readFileSync(tempPathFor(destination), "utf-8")).toBe("residue");
  });

  it("test_sem_exclusive_um_temporario_residuo_continua_sendo_truncado", async () => {
    // Arrange — the same scenario, WITHOUT the option: this is today's behavior, and it is preserved.
    const destination = join(dir, "config.json");
    writeFileSync(tempPathFor(destination), "residue");

    // Act
    await atomicWriteJson(destination, { novo: true });

    // Assert — the write won, and the temp file became the destination (nothing left over).
    expect(readFileSync(destination, "utf-8")).toBe('{\n  "novo": true\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("test_exclusive_writes_normally_when_there_is_no_residue", async () => {
    // Arrange — the option's happy path: with no residue, `exclusive` changes nothing observable.
    const destination = join(dir, "config.json");
    expect(existsSync(tempPathFor(destination))).toBe(false);

    // Act
    await atomicWriteJson(destination, { a: 1 }, { exclusive: true });

    // Assert
    expect(readFileSync(destination, "utf-8")).toBe('{\n  "a": 1\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
