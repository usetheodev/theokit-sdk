# Edge Case Review — cli-theokit

Data: 2026-05-22
Tasks analisadas: 8 (T0.1, T1.1, T2.1, T3.1, T4.1, T5.1, T6.1, T7.1)
Edge cases encontrados: 14 (MUST FIX: 5, SHOULD TEST: 6, DOCUMENT: 3)

## MUST FIX

### EC-A: Project name não validado contra regras do npm
- **Task afetada:** T2.1 (`theokit init`)
- **Família:** Input / Format
- **Cenário:** Usuário roda `theokit init "My App"` ou `theokit init UpperCase` ou `theokit init scoped/name`. Scaffold escreve o nome no `package.json` template literal `{{projectName}}`. Quando o usuário roda `pnpm install` no projeto scaffolded, npm rejeita: "name can only contain URL-friendly characters", "name cannot have uppercase", etc.
- **Impacto:** Onboarding quebra na PRIMEIRA ação pós-scaffold. Usuário não sabe se é bug do CLI ou config errada.
- **Fix:** Em `init/scaffold.ts`, antes do copy, validar via regex npm-compatível: `if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new ConfigurationError("Invalid project name. Use lowercase letters, numbers, dashes (e.g. my-bot)", { code: "invalid_project_name" });`. Adicionar test em T2.1 TDD.

### EC-B: Crash mid-scaffold deixa dest com arquivos parciais
- **Task afetada:** T2.1
- **Família:** State / Resource
- **Cenário:** Scaffold copia 5+ arquivos em sequência. Se usuário aperta Ctrl+C entre arquivo 2 e 3 (OU `ENOSPC` triggers mid-copy), `<dest>/` fica com 2 arquivos. Próximo `theokit init <same>` falha com "dest not empty" mesmo que o usuário queira retry.
- **Impacto:** Usuário fica preso — `theokit init` rejeita dest não-vazio (EC válido) mas o "vazio" foi corrompido pelo próprio CLI.
- **Fix:** Estratégia `scaffold-to-tmp-then-rename`: copiar tudo para `<dest>.tmp-<rand>/`, depois `fs.renameSync(<dest>.tmp, <dest>)` no final. Atomicidade total: ou tudo ou nada. ≤10 linhas em `scaffold.ts`. Adicionar test que simula erro mid-copy e assert `<dest>` não existe.

### EC-C: Templates não incluídos no published tarball
- **Task afetada:** T2.1 / T0.1 (`package.json` config)
- **Família:** Boundary / Format
- **Cenário:** `templates/<name>/` são arquivos no source. Por padrão `npm publish` inclui apenas `dist/` + `README.md` + `package.json`. Se `package.json` não tem `"files": ["dist", "templates"]`, o tarball publicado **NÃO inclui templates**, e `npx @usetheo/cli init` falha em consumers com "template path not found".
- **Impacto:** TODO o produto quebra em consumers reais (passa em monorepo dev por causa do workspace link). Bug invisível até primeira publicação real.
- **Fix:** Em `packages/cli/package.json`, adicionar:
  ```json
  "files": ["dist", "templates", "README.md", "CHANGELOG.md"]
  ```
  Adicionar test em T0.1 que faz `pnpm pack` + tar-list e asserta que `templates/minimal/package.json` está incluído no tarball.

### EC-E: SDK internals (`internal/*`) não são exportados pelo `package.json#exports`
- **Task afetada:** T3.1 (`theokit inspect`)
- **Família:** Integration / Boundary
- **Cenário:** Plano diz "inspect importa de `@usetheo/sdk` internals — `listProviders()`, `MEMORY_EMBEDDING_ADAPTERS`". Mas SDK `package.json` `exports` map só expõe `.`, `./cron`, `./errors`, `./tools`, `./path-safety`. `import { listProviders } from "@usetheo/sdk/internal/providers/registry"` quebra em runtime (ERR_PACKAGE_PATH_NOT_EXPORTED). Funciona em dev (monorepo source) mas falha em consumer install.
- **Impacto:** `theokit inspect` crasha com erro de import em todo install público.
- **Fix:** Adicionar uma API pública na SDK (`Theokit.inspect.builtins()` ou similar) que retorna `{ providers: [...], embeddingAdapters: [...], gatewayAdapters: [...] }`. Sub-task em T3.1: ADR D201 (novo) + `packages/sdk/src/theokit.ts` ganha `static readonly inspect = { builtins: () => ... }`. CLI consome a API pública. ≤15 linhas no SDK.

### EC-F: `--output` path traversal no `eval`
- **Task afetada:** T5.1 (`theokit eval`)
- **Família:** Permission / Security
- **Cenário:** Usuário roda `theokit eval --output /etc/passwd-report.md` OR `--output ../../../etc/passwd`. Plano texto diz "user-provided path must be inside cwd" mas nenhum task lista `safePathJoin` (D80) sendo chamado.
- **Impacto:** Sobrescreve arquivos fora do projeto. CI rodando CLI escala privilégios. Security hole.
- **Fix:** Em `eval/report.ts` (ou no command handler), antes de escrever: `const resolved = safePathJoin(process.cwd(), opts.output); if (resolved === undefined) throw new ConfigurationError("Output path must be inside cwd", { code: "invalid_output_path" });`. Reusa `safePathJoin` exportado de `@usetheo/sdk` (D79-D80). Test EC-F em TDD do T5.1.

## SHOULD TEST

### EC-G: Symlink em dest path durante scaffold
- **Task afetada:** T2.1
- **Teste sugerido:** `test_init_rejects_symlink_dest()` — criar tmpdir com `<dest>` sendo symlink para `/etc`. Scaffold deve detectar e rejeitar (não seguir o symlink). Verificar via `fs.lstatSync(dest).isSymbolicLink()`.

### EC-H: ENOSPC durante scaffold
- **Task afetada:** T2.1
- **Teste sugerido:** `test_init_handles_enospc_gracefully()` — mock `fs.writeFile` para throw ENOSPC no 2º arquivo. Assert: erro tipado com `code: "disk_full"` E `<dest>/` foi limpo (combina com EC-B fix — atomic rename, então tmp dir é deletado).

### EC-I: `tsx` bin não resolve (CLI install corrupted)
- **Task afetada:** T4.1
- **Teste sugerido:** `test_dev_actionable_error_when_tsx_missing()` — mock `require.resolve("tsx/cli")` para throw `MODULE_NOT_FOUND`. Assert: erro com mensagem "tsx not found — try `pnpm install` to repair @usetheo/cli", exit code 2.

### EC-J: Entry file com syntax error → tsx-watch loop infinito de restarts
- **Task afetada:** T4.1
- **Teste sugerido:** `test_dev_propagates_child_errors()` — entry file com `const x = ;` (syntax broken). Spawn tsx-watch, asserta que stderr é forwardado ao parent, asserta que CLI não trava infinito esperando o child stabilizar. Documentar comportamento: "tsx-watch tenta reload; usuário vê stderr e edita".

### EC-K: Async scorer (retorna Promise) no `eval`
- **Task afetada:** T5.1
- **Teste sugerido:** `test_eval_supports_async_scorer()` — `Scorer = (out) => Promise<Score>`. Plano diz "Pure function" mas user pode legitimamente querer chamar um LLM judge (async). Sub-cases: scorer async resolve → OK; scorer async rejects → mesmo `score=0, reason="scorer_error"` que sync throw. `Scorer` type union: `(out) => Score | Promise<Score>`.

### EC-L: `{{sdkVersion}}` substitui para `"workspace:*"` em dev mas precisa semver para publish
- **Task afetada:** T2.1
- **Teste sugerido:** `test_init_resolves_sdk_version_to_semver()` — quando CLI rodando do monorepo dev, `package.json` lista `@usetheo/sdk: workspace:*`. Scaffolded project NÃO pode receber `workspace:*` (quebra fora do monorepo). Resolver via `npm view @usetheo/sdk version` no build OU hard-code via tsup `define` na build da CLI. Test asserta que substituted package.json tem semver-string válido (`/^\d+\.\d+\.\d+/`).

## DOCUMENT

### EC-M: pnpm vs npm vs yarn — qual package manager o template assume?
- **Risco aceito:** Templates usam `pnpm install` e `pnpm dev`. User com `npm`/`yarn` instalado mas sem `pnpm` precisa instalar pnpm primeiro. **Documentar no README do template**: "Requires pnpm (https://pnpm.io). Alternative: manually translate `pnpm` → `npm` in scripts." NÃO adicionar lógica de detecção — mais complexo que vale.

### EC-N: Plugin name duplication entre `~/.theokit/plugins/` e `<cwd>/.theokit/plugins/`
- **Risco aceito:** Mesma mecânica de personalities (D162: project wins on collision). Documentar em inspect output: quando duplicada, marca a versão usada com `(overrides user-global)`. NÃO mudar comportamento — herda D162.

### EC-O: Dataset gigantesco (>10k rows) em `eval`
- **Risco aceito:** v1 carrega tudo em memória + roda `Agent.batch` com concurrency 4. Para >10k rows isso é OK em RAM (~MB). Para >100k seria streaming necessário, mas é v1.1+ work. Documentar no README de eval: "v1 suporta datasets até ~10k rows; para batches maiores, use `Eval.run()` quando Roadmap #2 shippar com streaming."

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T0.1 | 1                 | 1 (EC-C) | 0           | 0        |
| T1.1 | 0                 | 0        | 0           | 0        |
| T2.1 | 6                 | 2 (EC-A, EC-B) | 3 (EC-G, EC-H, EC-L) | 1 (EC-M) |
| T3.1 | 2                 | 1 (EC-E) | 0           | 1 (EC-N) |
| T4.1 | 2                 | 0        | 2 (EC-I, EC-J) | 0  |
| T5.1 | 3                 | 1 (EC-F) | 1 (EC-K)    | 1 (EC-O) |
| T6.1 | 0                 | 0        | 0           | 0        |
| T7.1 | 0                 | 0        | 0           | 0        |
| **Total** | **14**       | **5**    | **6**       | **3**    |

**Veredicto:** **PLANO PRECISA DE AJUSTE** — 5 MUST FIX (EC-A, EC-B, EC-C, EC-E, EC-F) devem ser absorvidos antes de iniciar a implementação. SHOULD TEST items são reforço de TDD; DOCUMENT items são notas no README. EC-C (templates não shipados) e EC-E (SDK internals não exportados) são especialmente críticos porque só aparecem em consumer real fora do monorepo — devs in-repo não veriam até a primeira publicação.
