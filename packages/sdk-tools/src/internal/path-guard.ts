/**
 * Re-export puro do path-guard canônico (#150).
 *
 * Este módulo ERA uma cópia vendorizada da implementação do `@theokit/sdk`, consumida pelas 9 tools
 * que tocam caminho. Duplicar uma primitiva de **segurança** entre pacotes significou que o canônico
 * evoluiu — blocklist de credenciais (`.ssh` `.aws` `.kube` `.npmrc` `id_rsa` `authorized_keys`
 * `*.pem` `*.key` `*.p12`), normalização case-insensitive, rejeição de NUL/control-char (T5.5), fix de
 * base na raiz do filesystem (#149) — enquanto a cópia ficou parada. Nada no CI comparava as duas, e a
 * divergência crescia a cada correção aplicada só de um lado: um agente lia `.ssh/id_rsa`,
 * `.aws/credentials` e `*.pem` pelo fork.
 *
 * O arquivo permanece como ponto de re-export para que os 9 consumidores não precisem mudar de import
 * (e para que este comentário fique no caminho de quem for tentado a vendorizar de novo). Ele NÃO
 * hospeda implementação: `@theokit/sdk` já é peerDependency, e todo símbolo que os consumidores usam
 * é público em `@theokit/sdk/path-safety`.
 *
 * Regressão travada por `tests/path-guard-no-fork.test.ts`, que assere PARIDADE com o canônico — o
 * defeito era a duplicação, não a versão dela, e reintroduzir uma cópia atualizada só reiniciaria o
 * relógio da divergência.
 *
 * @internal
 */

export {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "@theokit/sdk/path-safety";
