/**
 * REGRESSION (#150) — o path-guard deste pacote NÃO pode ser um fork do canônico.
 *
 * `src/internal/path-guard.ts` era uma cópia vendorizada, consumida pelas 9 tools que tocam caminho.
 * O canônico (`@theokit/sdk` → `internal/security/path-guard.ts`) evoluiu — blocklist de credenciais,
 * normalização case-insensitive, rejeição de NUL/control-char (T5.5), fix de base na raiz (#149) — e a
 * cópia ficou parada. Nada no CI comparava as duas, então a divergência crescia a cada correção
 * aplicada só de um lado, e o agente lia `.ssh/id_rsa`, `.aws/credentials` e `*.pem` por ela.
 *
 * O defeito é a DUPLICAÇÃO, não a versão dela: reintroduzir a cópia atualizada só reinicia o relógio
 * da divergência. Por isso o teste assere PARIDADE com o canônico, não uma lista de comportamentos.
 */
import {
  isForbiddenPath as canonico,
  safePathJoin as joinCanonico,
} from "@theokit/sdk/path-safety";
import { describe, expect, it } from "vitest";

import { isForbiddenPath, safePathJoin } from "../src/internal/path-guard.js";

/** Caminhos que o canônico bloqueia — cada um foi lido de verdade pelo fork antes do fix (#150). */
const SEGREDOS = [
  ".ssh/id_rsa",
  ".ssh/id_ed25519",
  ".aws/credentials",
  ".kube/config",
  ".npmrc",
  "server.pem",
  "client.key",
  "bundle.p12",
  "authorized_keys",
  // bypass por CAIXA: o fork comparava sem `toLowerCase()`
  ".GIT/config",
  ".SSH/id_rsa",
];

/** Caminhos de código normal — devem seguir liberados, senão a correção quebrou o uso legítimo. */
const LEGITIMOS = ["src/app.ts", "README.md", "tests/foo.test.ts", "packages/a/src/b.ts"];

describe("#150 — path-guard sem fork do canônico", () => {
  it("test_bloqueia_todo_segredo_que_o_canonico_bloqueia", () => {
    for (const p of SEGREDOS) {
      expect(canonico(p), `fixture inválida: o canônico deveria bloquear ${p}`).toBe(true);
      expect(isForbiddenPath(p), `${p} escapou do guard deste pacote`).toBe(true);
    }
  });

  it("test_nao_bloqueia_codigo_legitimo", () => {
    for (const p of LEGITIMOS) {
      expect(canonico(p)).toBe(false);
      expect(isForbiddenPath(p), `${p} foi bloqueado indevidamente`).toBe(false);
    }
  });

  it("test_rejeita_nul_e_control_char_como_o_canonico", () => {
    // T5.5 — presente no canônico em 6 call sites, ausente no fork.
    const NUL = String.fromCharCode(0);
    const CONTROL = String.fromCharCode(0x1f);
    expect(() => joinCanonico("/tmp", `a${NUL}b`)).toThrow();
    expect(() => safePathJoin("/tmp", `a${NUL}b`)).toThrow();
    expect(() => safePathJoin("/tmp", `a${CONTROL}b`)).toThrow();
  });

  it("test_base_na_raiz_do_filesystem_aceita_caminho", () => {
    // #149 — o fork recusava TODO caminho quando a base era `/`.
    expect(safePathJoin("/", "a.txt")).toBe(joinCanonico("/", "a.txt"));
  });

  it("test_segue_recusando_escape_de_diretorio", () => {
    // A âncora anti-afrouxamento: a paridade não pode ter vindo de desligar a defesa.
    expect(() => safePathJoin("/tmp/base", "..", "etc", "passwd")).toThrow();
    expect(() => joinCanonico("/tmp/base", "..", "etc", "passwd")).toThrow();
  });
});
