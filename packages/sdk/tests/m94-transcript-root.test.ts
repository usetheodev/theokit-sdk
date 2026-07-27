/**
 * M94 Fase 1 — a raiz de transcript honra THEOKIT_HOME como seus irmãos.
 *
 * O ROADMAP diz "como `catalog-source-models-dev.ts:49`". Medido: aquele irmão é
 * **home-ancorado com override por env**. O `getTheokitHome(cwd)` de `paths.ts`
 * é **cwd-ancorado** — reusá-lo moveria o transcript de todo mundo que NÃO define
 * a variável, muito além do risco #1 do ROADMAP. Ver ADR-2 do plano.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultBaseDir, transcriptRoot } from "../src/internal/persistence/session-transcript.js";

const original = process.env.THEOKIT_HOME;
afterEach(() => {
  if (original === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = original;
});

describe("M94 — transcriptRoot", () => {
  it("honra THEOKIT_HOME quando setada", () => {
    process.env.THEOKIT_HOME = "/tmp/m94-raiz-custom";
    expect(transcriptRoot()).toBe("/tmp/m94-raiz-custom");
  });

  it("ignora THEOKIT_HOME vazia ou só com espaço (mesma disciplina do irmão)", () => {
    process.env.THEOKIT_HOME = "   ";
    expect(transcriptRoot()).toBe(join(homedir(), ".theokit"));
  });

  it("faz fallback para ~/.theokit — NÃO para <cwd>/.theokit (ADR-2)", () => {
    delete process.env.THEOKIT_HOME;
    expect(transcriptRoot()).toBe(join(homedir(), ".theokit"));
    expect(transcriptRoot()).not.toBe(join(process.cwd(), ".theokit"));
  });

  it("defaultBaseDir delega — inline de homedir() reprova aqui", () => {
    process.env.THEOKIT_HOME = "/tmp/m94-delega";
    expect(defaultBaseDir()).toBe("/tmp/m94-delega");
  });
});
