/**
 * M107 T1.1 — `exclusive?: true` faz o temporário nascer por criação EXCLUSIVA (`wx`).
 *
 * ## A costura, e por que ela é obrigatória (EC-4 do `/edge-case-plan`)
 *
 * O teste que o plano pediu — *"pré-plantar o temporário e afirmar que a escrita rejeita"* — é
 * **inescrevível como especificado**. O nome do temporário é
 * `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
 * (`src/internal/persistence/atomic-write.ts:106-107`): 64 bits de CSPRNG, exatamente o que o T5.7
 * introduziu para que ninguém — nem um atacante, nem este teste — consiga prever o caminho.
 *
 * A costura é portanto **`vi.mock("node:crypto")`**, tornando `randomBytes` determinístico só dentro
 * deste arquivo. Ela vive num arquivo separado de propósito: `vi.mock` substitui o módulo para todo o
 * grafo do arquivo de teste, e contaminar `atomic-write-json.test.ts` — que afirma justamente o
 * comportamento de produção — seria trocar um oráculo por um cenário.
 *
 * Nenhuma costura foi aberta no código de PRODUÇÃO: o gerador de sufixo continua sendo o `node:crypto`
 * real em runtime. Injetá-lo como parâmetro para facilitar o teste seria acrescentar superfície que
 * ninguém pediu (rung 5 de `.claude/rules/parsimony-ladder.md`).
 *
 * ## Contraprova por mutação (executada; saída no log da iteração)
 *
 * | Mutação em `atomic-write.ts` | Testes que morrem |
 * |---|---|
 * | `const flag = options?.exclusive === true ? "wx" : "w"` → `const flag = "w"` | `test_exclusive_falha_quando_o_temporario_ja_existe` |
 *
 * O par de testes é o que dá significado à mutação: sem `exclusive`, um temporário resíduo **é**
 * truncado (comportamento de hoje, preservado); com `exclusive`, ele é uma recusa. Um teste só do
 * ramo `true` passaria também sob a mutação inversa (`flag = "wx"` sempre), que quebraria todo
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

/** O caminho do temporário que a produção vai escolher, dado o `randomBytes` determinístico acima. */
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

describe("M107 T1.1 — exclusive faz o temporário nascer por criação exclusiva", () => {
  it("test_exclusive_falha_quando_o_temporario_ja_existe", async () => {
    // Arrange — o temporário que a produção escolheria já está em disco (resíduo de uma escrita
    // interrompida, ou plantado). O destino tem conteúdo anterior que não pode ser perdido.
    const destino = join(dir, "config.json");
    writeFileSync(destino, '{\n  "anterior": true\n}\n');
    writeFileSync(caminhoDoTemporario(destino), "residuo");

    // Act + Assert — a criação exclusiva recusa com o erro do SISTEMA, não silenciada.
    await expect(atomicWriteJson(destino, { novo: true }, { exclusive: true })).rejects.toThrow(
      /EEXIST/,
    );

    // Assert — o destino NÃO foi tocado, e o resíduo também não (a recusa acontece na criação).
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "anterior": true\n}\n');
    expect(readFileSync(caminhoDoTemporario(destino), "utf-8")).toBe("residuo");
  });

  it("test_sem_exclusive_um_temporario_residuo_continua_sendo_truncado", async () => {
    // Arrange — o mesmo cenário, SEM a opção: é o comportamento de hoje, e ele é preservado.
    const destino = join(dir, "config.json");
    writeFileSync(caminhoDoTemporario(destino), "residuo");

    // Act
    await atomicWriteJson(destino, { novo: true });

    // Assert — a escrita venceu, e o temporário virou o destino (nada sobrou).
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "novo": true\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("test_exclusive_escreve_normalmente_quando_nao_ha_residuo", async () => {
    // Arrange — o caminho feliz da opção: sem resíduo, `exclusive` não muda nada de observável.
    const destino = join(dir, "config.json");
    expect(existsSync(caminhoDoTemporario(destino))).toBe(false);

    // Act
    await atomicWriteJson(destino, { a: 1 }, { exclusive: true });

    // Assert
    expect(readFileSync(destino, "utf-8")).toBe('{\n  "a": 1\n}\n');
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
