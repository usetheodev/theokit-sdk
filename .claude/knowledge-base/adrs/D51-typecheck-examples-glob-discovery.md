# D51 — `tools/typecheck-examples.sh` continua descobrindo examples via glob

**Status:** Decided
**Date:** 2026-05-17

## Decision

`tools/typecheck-examples.sh` mantém o pattern atual de descobrir examples via glob `examples/*/`. Novos examples são auto-incluídos sem mudança no script.

Para que um diretório dentro de `examples/` seja considerado um example válido pelo script, ele DEVE conter:
- `package.json`
- `tsconfig.json`
- diretório `src/` com pelo menos um `*.ts` arquivo

Diretórios sem essa estrutura são skipped silenciosamente.

## Rationale

- **Pattern já estabelecido** — funciona desde a v1.0; sem necessidade de mudar.
- **Zero config para novos examples** — basta criar o diretório e arquivos, próximo run de typecheck-examples pega.
- **Glob é O(n) em number-of-examples** — escalável.
- **Convenção sobre configuração** — examples seguem mesma estrutura → fácil de auditar e ler.

Alternativas consideradas:

- **Lista explícita em `EXAMPLES=(...)` no script**: rejeitado — toda adição de example requer mudança no script + risco de esquecer.
- **Manifest file em `examples/manifest.json`**: rejeitado — extra arquivo para manter; valor zero sobre o glob.
- **Auto-detect via `package.json` em subdirs**: complexidade equivalente ao glob, sem ganho.

## Consequences

- 5 examples novos deste plano são auto-incluídos no `tools/typecheck-examples.sh`.
- Total esperado de PASS sobe de 41 para 46.
- Examples que NÃO devem aparecer no relatório precisam ser nomeados com prefixo `_` (ex: `_archive/`) OU estar em `.gitignore` que o script honra via `git ls-files`.
- Convenção: cada example tem `src/index.ts` (entrypoint). Examples multi-arquivo (e.g., Next.js com `src/app/`) precisam de `tsconfig.json` apontando para `src/**/*.ts`.
