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
 * grafo do arquivo de teste, e contaminar `atomic-write-json.test.ts` — que afirma justamente o
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
 * | `const flag = options?.exclusive === true ? "wx" : "w"` → `const flag = "w"` | `test_exclusive_falha_quando_o_temporario_ja_existe` |
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
function caminhoDoTemporario(destino: string): string {
  return `${destino}.${process.pid}.${Buffer.alloc(8, 0xab).toString("hex")}.tmp`;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "m107-exclusive-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("M107 T1.1 — exclusive makes the temp file born by exclusive creation", () => {
  it("test_exclusive_falha_quando_o_temporario_ja_existe", async () => {
    // Arrange — the temp file production would choose is already on disk (residue of an interrupted
    // write, or planted). The destination has prior content that must not be lost.
    const destino = join(dir, "config.json");
    writeFileSync(destino, '{\n  "anterior": true\n}\n');
    writeFileSync(caminhoDoTemporario(destino), "residuo");

    // Act + Assert — exclusive creation refuses with the SYSTEM's error, not silenced.
    await expect(atomicWriteJson(destino, { novo: true }, { exclusive: true })).rejects.toThrow(
      /EEXIST/,
    );

    // Assert — the destination was NOT touched, nor was the residue (the refusal happens at creation).
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "anterior": true\n}\n');
    expect(readFileSync(caminhoDoTemporario(destino), "utf-8")).toBe("residuo");
  });

  it("test_sem_exclusive_um_temporario_residuo_continua_sendo_truncado", async () => {
    // Arrange — the same scenario, WITHOUT the option: this is today's behavior, and it is preserved.
    const destino = join(dir, "config.json");
    writeFileSync(caminhoDoTemporario(destino), "residuo");

    // Act
    await atomicWriteJson(destino, { novo: true });

    // Assert — the write won, and the temp file became the destination (nothing left over).
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "novo": true\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("test_exclusive_escreve_normalmente_quando_nao_ha_residuo", async () => {
    // Arrange — the option's happy path: with no residue, `exclusive` changes nothing observable.
    const destino = join(dir, "config.json");
    expect(existsSync(caminhoDoTemporario(destino))).toBe(false);

    // Act
    await atomicWriteJson(destino, { a: 1 }, { exclusive: true });

    // Assert
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "a": 1\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
