/**
 * RED tests for T1.1 — `atomicWriteJson<T>` typed helper.
 * Includes EC-4 (auto-mkdir parent directory).
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteJson } from "../../../src/internal/persistence/atomic-write.js";

/** Bits de permissão de `caminho`, sem o tipo de nó. */
function modo(caminho: string): number {
  return statSync(caminho).mode & 0o777;
}

/**
 * Roda `fn` sob um `umask` específico e restaura o anterior — sempre, mesmo em falha.
 *
 * O `umask` é estado de PROCESSO. A suíte deste pacote roda em fork único
 * (`vitest.config.ts`: `singleFork: true`), então vazar um `umask` daqui contaminaria todo teste
 * que criasse arquivo depois. O `finally` é o que impede isso.
 */
async function sobUmask(mask: number, fn: () => Promise<void>): Promise<void> {
  const anterior = process.umask(mask);
  try {
    await fn();
  } finally {
    process.umask(anterior);
  }
}

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes JSON with default 2-space indent", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { foo: "bar", nested: { count: 1 } });
    const content = readFileSync(path, "utf-8");
    expect(content).toBe('{\n  "foo": "bar",\n  "nested": {\n    "count": 1\n  }\n}\n');
  });

  it("appends trailing newline by default", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 });
    const content = readFileSync(path, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("respects indent option", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 }, { indent: 4 });
    expect(readFileSync(path, "utf-8")).toBe('{\n    "a": 1\n}\n');
  });

  it("respects trailingNewline=false option", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 }, { trailingNewline: false });
    const content = readFileSync(path, "utf-8");
    expect(content.endsWith("\n")).toBe(false);
    expect(content).toBe('{\n  "a": 1\n}');
  });

  it("throws TypeError on undefined data", async () => {
    const path = join(dir, "config.json");
    await expect(atomicWriteJson(path, undefined)).rejects.toThrow(TypeError);
  });

  it("EC-4: auto-creates missing parent directories", async () => {
    const path = join(dir, "nested", "deep", "config.json");
    await atomicWriteJson(path, { a: 1 });
    expect(readFileSync(path, "utf-8")).toBe('{\n  "a": 1\n}\n');
  });

  it("leaves no .tmp files on success", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 });
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("propagates circular reference errors", async () => {
    const path = join(dir, "config.json");
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    await expect(atomicWriteJson(path, circular)).rejects.toThrow();
  });
});

/**
 * M107 T1.1 — `{ mode?, exclusive? }` no options bag já publicado.
 *
 * ## O default é byte-idêntico, e isso NÃO é grátis (EC-3)
 *
 * Hoje `replaceFileAtomic` faz `open(tmp, "w", 0o600)` **sem `fchmod`**. O argumento de modo do
 * `open` é filtrado pelo `umask`, que só **limpa** bits — então o modo em disco de hoje depende do
 * `umask` do processo. Medido nesta máquina ANTES da mudança (`node` reproduzindo o caminho de
 * `atomic-write.ts:106-122`):
 *
 * ```
 * umask 0o002  ->  tmp=0o600  final=0o600
 * umask 0o022  ->  tmp=0o600  final=0o600
 * umask 0o200  ->  tmp=0o400  final=0o400      <-- o bit de escrita do dono é limpo pelo umask
 * ```
 *
 * Um `chmod` **incondicional** no descritor levaria o caso `umask 0o200` de `0o400` para `0o600` —
 * mudança de disco para **todo** chamador que não pediu nada, incluindo consumidores externos
 * desconhecidos. Por isso a reafirmação de modo é **condicional a `mode !== undefined`**, e
 * `test_sem_opcoes_o_comportamento_e_identico` afirma os dois números medidos acima, não um número
 * bonito. É o teste que reprova se a reafirmação virar incondicional.
 *
 * ## Por que reafirmar, então
 *
 * Quando o chamador PEDE um modo, o `umask` não pode ter a última palavra em silêncio — era
 * exatamente a razão escrita no contorno local que este item existe para apagar. A reafirmação vai no
 * DESCRITOR, antes do `rename`, e nunca depois: dar `chmod` depois do rename deixaria o arquivo
 * brevemente com o modo do umask, que é o anti-padrão medido em
 * `references/opencode/packages/core/src/fs-util.ts:110-114`. A forma escolhida — modo como
 * parâmetro do `open` — é a da referência única
 * (`references/codex/codex-rs/network-proxy/src/certs.rs:687,783-791`).
 */
describe("M107 T1.1 — atomicWriteJson honra mode e exclusive", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "m107-atomic-mode-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("test_sem_opcoes_o_comportamento_e_identico", async () => {
    // Arrange — os dois modos MEDIDOS antes da mudança, por umask.
    const medidoAntes = new Map([
      [0o002, 0o600],
      [0o200, 0o400],
    ]);

    for (const [mask, esperado] of medidoAntes) {
      await sobUmask(mask, async () => {
        const semBag = join(dir, `sem-bag-${mask.toString(8)}.json`);
        const bagVazio = join(dir, `bag-vazio-${mask.toString(8)}.json`);

        // Act
        await atomicWriteJson(semBag, { a: 1 });
        await atomicWriteJson(bagVazio, { a: 1 }, {});

        // Assert — conteúdo E modo idênticos ao de antes da mudança, sob o MESMO umask.
        expect(readFileSync(semBag, "utf-8")).toBe('{\n  "a": 1\n}\n');
        expect(readFileSync(bagVazio, "utf-8")).toBe('{\n  "a": 1\n}\n');
        expect(modo(semBag)).toBe(esperado);
        expect(modo(bagVazio)).toBe(esperado);
      });
    }
  });

  it("test_mode_e_honrado_mesmo_quando_o_umask_limparia_o_bit", async () => {
    // Arrange — `umask 0o200` limpa o bit de escrita do dono. Sem a reafirmação no descritor, o
    // arquivo sai `0o400` (medido) e o pedido do chamador é perdido em SILÊNCIO.
    const path = join(dir, "pedido-explicito.json");

    await sobUmask(0o200, async () => {
      // Act
      await atomicWriteJson(path, { a: 1 }, { mode: 0o600 });

      // Assert
      expect(modo(path)).toBe(0o600);
    });
  });

  it("test_mode_mais_permissivo_que_o_default_e_honrado", async () => {
    // Arrange — a primitiva não impõe política: ela troca o DEFAULT, não a liberdade do chamador.
    const path = join(dir, "permissivo.json");

    await sobUmask(0o002, async () => {
      // Act
      await atomicWriteJson(path, { a: 1 }, { mode: 0o644 });

      // Assert — sem honrar `mode`, sairia `0o600` (o literal fixo de hoje).
      expect(modo(path)).toBe(0o644);
    });
  });

  it("test_mode_invalido_propaga_o_erro_do_sistema", async () => {
    // Arrange — CASO NEGATIVO (distinto do de borda): o modo é inválido, não extremo.
    const path = join(dir, "modo-invalido.json");

    // Act + Assert — o erro do sistema SOBE; não é convertido num tipo do SDK nem engolido
    // (`.claude/rules/error-handling.md § 2`). E nada foi escrito no destino.
    await expect(atomicWriteJson(path, { a: 1 }, { mode: -1 })).rejects.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("test_falha_no_rename_nao_deixa_temporario", async () => {
    // Arrange — REGRESSÃO (não RED): o destino é um diretório NÃO-VAZIO, então o `rename` falha.
    // O que se prova é que a limpeza do temporário continua valendo no caminho novo.
    const path = join(dir, "alvo-ocupado");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "ocupante.txt"), "x");

    // Act + Assert
    await expect(atomicWriteJson(path, { a: 1 }, { mode: 0o600 })).rejects.toThrow();
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("test_dois_escritores_concorrentes_no_mesmo_destino_nao_produzem_arquivo_parcial", async () => {
    // Arrange — a atomicidade sob múltiplos escritores é o contrato do módulo, e `mode`/`exclusive`
    // mexem na CRIAÇÃO, que é onde uma corrida se manifestaria.
    const path = join(dir, "disputado.json");
    const conteudos = [0, 1, 2, 3, 4, 5, 6, 7];

    // Act
    await Promise.all(conteudos.map(async (n) => atomicWriteJson(path, { n }, { mode: 0o600 })));

    // Assert (happens-before observation, depois da barreira) — o arquivo contém EXATAMENTE um dos
    // conteúdos, nunca uma mistura, e nenhum temporário sobrou.
    const lido = JSON.parse(readFileSync(path, "utf-8")) as { n: number };
    expect(conteudos).toContain(lido.n);
    expect(modo(path)).toBe(0o600);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});
