/**
 * M96 U3 (Fase 1, T1.1/T1.2) — `settingSources` deixa de ser um `true` literal na porta pública.
 *
 * ## O defeito que estes testes fecham
 *
 * `subagents-loader.ts:29-31` chamava `loadSubagents(cwd, true, undefined)`. O loader interno
 * (`internal/runtime/skills/subagents-loader.ts:19`) SEMPRE aceitou o parâmetro
 * `settingSourcesIncludeProject` — a porta pública é que o escondia atrás de um literal, contra a
 * própria docstring de `settingSources` do SDK. Publicar o parâmetro é o U3.
 *
 * ## Por que união fechada e não booleano (ADR D7 do plano m96)
 *
 * Um `boolean` posicional não admite uma terceira fonte sem breaking, e é ilegível no ponto de
 * chamada. O peer que resolveu o mesmo problema usou parâmetro nomeado
 * (`gemini-cli/agentLoader.ts:637-642`). O default `['project']` reproduz byte a byte o
 * comportamento do `true` de hoje.
 *
 * ## O oráculo do caso negativo (ADR D4)
 *
 * `settingSources: []` tem de devolver `{}` **e** não ter lido o diretório. Um teste que só olhasse
 * o retorno vazio passaria numa implementação que lê tudo e filtra depois — e essa implementação
 * falharia o propósito de segurança do M97, que gateia a LEITURA da fonte de projeto.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import {
  type AgentDefinition,
  discoverSubagents,
  loadSubagentDefinition,
} from "../src/subagents-loader.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn(actual.readdir) };
});

const { readdir } = await import("node:fs/promises");
const readdirEspiao = vi.mocked(readdir);

const cwd = mkdtempSync(join(tmpdir(), "m96-setting-sources-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const dirAgentes = join(cwd, ".theokit", "agents");
mkdirSync(dirAgentes, { recursive: true });
writeFileSync(
  join(dirAgentes, "analista.md"),
  "---\nname: analista\ndescription: analisa\n---\n\nVocê analisa.\n",
);

function leiturasDoDiretorioDeAgentes(): unknown[] {
  return readdirEspiao.mock.calls.filter(
    ([caminho]) => typeof caminho === "string" && caminho.includes(join(".theokit", "agents")),
  );
}

describe("M96 U3 — settingSources na porta pública do loader", () => {
  it("test_discoverSubagents_sem_opcoes_continua_lendo_a_fonte_de_projeto", async () => {
    // A contraprova do default: sem ela, trocar o default para `[]` passaria em todos os
    // testes novos e apagaria a rota de subagentes de projeto em silêncio.
    const encontrados = await discoverSubagents(cwd);
    expect(Object.keys(encontrados)).toContain("analista");
  });

  it("test_settingSources_project_e_equivalente_ao_default", async () => {
    const comDefault = await discoverSubagents(cwd);
    const explicito = await discoverSubagents(cwd, { settingSources: ["project"] });
    expect(explicito).toEqual(comDefault);
  });

  it("test_NEGATIVO_settingSources_vazio_devolve_objeto_vazio_E_NAO_LE_O_DIRETORIO", async () => {
    readdirEspiao.mockClear();

    const encontrados = await discoverSubagents(cwd, { settingSources: [] });

    expect(encontrados, "sem fonte declarada não há subagente a devolver").toEqual({});
    expect(
      leiturasDoDiretorioDeAgentes(),
      "o efeito colateral ausente (D4): o diretório não pode ter sido lido",
    ).toHaveLength(0);
  });

  it("test_NEGATIVO_uma_fonte_desconhecida_e_erro_tipado", async () => {
    // error-handling.md § 2: erro tipado nomeando o valor recebido e as fontes aceitas, nunca um
    // `undefined` silencioso nem um filtro que descarta a fonte inválida sem avisar.
    const fonteInvalida = ["global"] as unknown as readonly "project"[];

    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      ConfigurationError,
    );
    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      /global.*project/s,
    );
  });

  it("test_NEGATIVO_uma_fonte_desconhecida_NAO_LE_O_DIRETORIO", async () => {
    // A metade de efeito do caso negativo acima: recusar DEPOIS de ler já teria lido.
    readdirEspiao.mockClear();
    const fonteInvalida = ["global"] as unknown as readonly "project"[];

    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      ConfigurationError,
    );
    expect(leiturasDoDiretorioDeAgentes()).toHaveLength(0);
  });

  it("test_loadSubagentDefinition_repassa_as_opcoes", async () => {
    // A segunda porta pública do mesmo módulo não pode ficar sem o parâmetro; sem esta asserção o
    // U3 fecharia metade da superfície.
    expect(await loadSubagentDefinition("analista", cwd)).toBeDefined();
    expect(await loadSubagentDefinition("analista", cwd, { settingSources: [] })).toBeUndefined();
  });

  it("test_a_aridade_publicada_e_2_porque_a_assinatura_NAO_tem_inicializador", async () => {
    // EC-6: `function f(cwd, options)` devolve 2; `function f(cwd, options = {})` devolve 1. As duas
    // formas implementam D7, e só uma satisfaz os critérios que ancoram em aridade (T2.1, T7.1).
    // O oráculo PRIMÁRIO daqueles critérios é o de efeito (`{ settingSources: [] }` → `{}`), medido
    // acima; esta é a asserção secundária que fixa a forma no ponto onde ela é decidida.
    expect(discoverSubagents.length).toBe(2);
  });

  it("test_o_tipo_da_definicao_e_alcancavel_pelo_subpath_do_loader", async () => {
    // D6: a camada `@theokit/agents` vai aliasar este tipo como `SubagentDefinition`, e o alias
    // precisa de um símbolo de onde resolver. `tsconfig.json` inclui `tests/**/*`, então
    // `pnpm typecheck` é quem executa esta asserção — o valor em runtime só a ancora.
    const encontrados: Record<string, AgentDefinition> = await discoverSubagents(cwd);
    const analista: AgentDefinition | undefined = encontrados.analista;
    expect(analista?.description).toBe("analisa");
  });
});
