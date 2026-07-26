/**
 * M76 review (H1) — o guard de segredo por segmento, testado DIRETAMENTE.
 *
 * ## Por que este arquivo existe
 *
 * O review por mutação provou que 3 dos 4 ramos de decisão não tinham oráculo. Reduzir
 * `SEGMENTOS_SENSIVEIS` a `{".env"}` — deixando `.git`, `node_modules` e `.theo` passarem —, inverter
 * a exceção do `.env.example` ou remover a regex `/^\.env\./` (que pega `.env.production`) **passavam
 * com a suíte inteira verde**. Só o literal `.env` estava coberto, e por acaso: via um teste de
 * `list-dir` que exercitava um caminho com esse segmento.
 *
 * O guard é a metade não-negociável do `allowAbsolute`: `isForbiddenPath` só bloqueia o item sensível
 * quando ele é o PRIMEIRO segmento, então um `/home/u/proj/.env/sub` passaria. Testá-lo apenas de
 * viés, através de uma tool, é o que permitiu que 3 ramos ficassem sem prova.
 *
 * ## Além disso, ele tinha DUAS cópias
 *
 * A "promoção" do M76 moveu o guard para `path-scope.ts` mas deixou a cópia privada em
 * `read-file.ts` — criando exatamente a duplicação que o docblock do promovido dizia existir para
 * evitar. Agora há uma só, e este arquivo é o oráculo dela.
 */
import { describe, expect, it } from "vitest";

import { ehProibidoEmQualquerProfundidade } from "../src/path-scope.js";

describe("M76 review — guard de segredo por qualquer segmento", () => {
  it("test_bloqueia_cada_segmento_sensivel_em_profundidade", () => {
    // O ramo que a mutação "reduzir a lista a {.env}" quebrava sem que nada percebesse.
    for (const seg of [".env", ".git", "node_modules", ".theo"]) {
      expect(
        ehProibidoEmQualquerProfundidade(`/home/u/proj/${seg}/sub/x`),
        `"${seg}" num segmento intermediário tem de bloquear`,
      ).toBe(true);
    }
  });

  it("test_bloqueia_variantes_de_env_como_env_production", () => {
    // O ramo da regex `/^\.env\./`. Sem ele, `.env.production` — que carrega segredo de produção —
    // passaria, enquanto `.env` bloqueia. A pior forma de falha: parcial e plausível.
    for (const seg of [".env.production", ".env.local", ".env.staging"]) {
      expect(ehProibidoEmQualquerProfundidade(`/a/${seg}/b`), `"${seg}" tem de bloquear`).toBe(
        true,
      );
    }
  });

  it("test_env_example_e_a_EXCECAO_e_continua_liberado", () => {
    // O ramo da exceção. `.env.example` é template versionado — bloqueá-lo seria falso positivo, e
    // um falso positivo aqui ensina o usuário a desligar o guard.
    expect(ehProibidoEmQualquerProfundidade("/a/.env.example/b")).toBe(false);
    expect(ehProibidoEmQualquerProfundidade("/a/.env.example")).toBe(false);
  });

  it("test_caminho_limpo_NAO_bloqueia", () => {
    // CONTRAPROVA: sem ela, uma implementação que devolvesse `true` sempre passaria em tudo acima.
    expect(ehProibidoEmQualquerProfundidade("/home/u/proj/src/lib")).toBe(false);
    expect(ehProibidoEmQualquerProfundidade("/usr/share/doc")).toBe(false);
  });

  it("test_separador_do_windows_tambem_e_analisado", () => {
    // O `replace(/\\/g, "/")` do guard. Sem ele, um caminho com barra invertida escaparia inteiro.
    expect(ehProibidoEmQualquerProfundidade("C:\\proj\\.git\\config")).toBe(true);
  });
});
