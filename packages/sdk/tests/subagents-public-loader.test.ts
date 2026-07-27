/**
 * M81 T2.1 — o loader de subagents em disco vira público.
 *
 * ## A assimetria que causou a duplicação
 *
 * `src/skills.ts:19` já exporta `discoverSkills` para o domínio irmão. Subagents tinham o mesmo
 * loader — `internal/runtime/skills/subagents-loader.ts` — mas **sem porta pública**. Um consumidor
 * atrás da fronteira INQUEBRÁVEL (`agent-builder` nunca importa `@theokit/sdk*`) não conseguia
 * alcançá-lo, e a única saída legal era reimplementar.
 *
 * Foi o que aconteceu. `agents/subagents/roles.ts:13-16` documenta o resultado, por escrito:
 *
 * > *"`loadRole` reads the disk `.md` with a lightweight frontmatter parse … This is a **SEPARATE
 * > reader** from the SDK's own `.theokit/agents` loader … so the two **can technically drift** — the
 * > drift guard in `roles-materialize.test.ts` reads the raw `.md` independently and pins the
 * > resolved whitelist against it to catch that."*
 *
 * Um teste que existe apenas para vigiar uma duplicação é a prova mais limpa de que a duplicação não
 * deveria existir. Com esta promoção, `loadRole` e o teste de drift podem ser deletados — e essa
 * deleção é o critério de sucesso do milestone (ADR D1 do plano).
 *
 * ## O que se exporta é a config PARSEADA, não o formato de arquivo
 *
 * Risco #2 do ROADMAP: exportar o loader pode congelar um formato interno como API pública. Por isso
 * o retorno é `AgentDefinition` — o dado já interpretado — e não o texto do `.md` nem a forma do
 * frontmatter. O formato de arquivo permanece detalhe interno, livre para mudar.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { discoverSubagents } from "../src/subagents-loader.js";

const cwd = mkdtempSync(join(tmpdir(), "m81-subagents-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const dirAgentes = join(cwd, ".theokit", "agents");
mkdirSync(dirAgentes, { recursive: true });
writeFileSync(
  join(dirAgentes, "explorer.md"),
  "---\nname: explorer\ndescription: explora o repo\ntools: read_file, search_text\n---\n\nVocê explora.\n",
);
writeFileSync(
  join(dirAgentes, "analyst.md"),
  "---\nname: analyst\ndescription: analisa\n---\n\nVocê analisa.\n",
);

describe("M81 T2.1 — loader de subagents público", () => {
  it("test_discoverSubagents_lista_os_do_diretorio", async () => {
    const encontrados = await discoverSubagents(cwd);
    expect(Object.keys(encontrados).sort()).toEqual(["analyst", "explorer"]);
  });

  it("test_devolve_a_config_PARSEADA_e_nao_o_formato_de_arquivo", async () => {
    // Risco #2 do ROADMAP. Devolver o texto do `.md` ou a forma do frontmatter congelaria um formato
    // interno como API pública; devolver `AgentDefinition` deixa o formato livre para mudar.
    const encontrados = await discoverSubagents(cwd);
    const explorer = encontrados["explorer"] as unknown as Record<string, unknown>;

    expect(explorer["description"], "a descrição tem de vir interpretada").toBe("explora o repo");
    expect(
      JSON.stringify(explorer),
      "o retorno não pode carregar o texto bruto do frontmatter",
    ).not.toContain("---");
  });

  it("test_CONTRAPROVA_diretorio_vazio_devolve_lista_vazia_sem_lancar", async () => {
    // Um projeto sem subagents é o caso comum, não um erro. Sem esta contraprova, uma implementação
    // que lançasse em `ENOENT` passaria nos testes acima e quebraria todo projeto novo.
    const vazio = mkdtempSync(join(tmpdir(), "m81-vazio-"));
    try {
      expect(await discoverSubagents(vazio)).toEqual({});
    } finally {
      rmSync(vazio, { recursive: true, force: true });
    }
  });
});
