# Plan: Markdown Config Migration — ✅ COMPLETED 2026-05-19

> **Status: COMPLETED 2026-05-19.** All 6 phases + Final Dogfood QA validated.
> 628/628 SDK tests green (was 564 pre-plan; +64 new: yaml-frontmatter 11 +
> markdown-config-loader 12 + hooks-frontmatter 7 + hooks-source 8 +
> context-frontmatter 5 + plugin-frontmatter 5 + plugins-manager 6 +
> migrate-config 9 + lint 1). Zero typecheck errors. Zero biome warnings in
> plan-touched files. 5 ADRs (D74-D78) committed.
> **Live CDP telegram-pro dogfood: 25/25 PASS in 42.2s** (real bot, MD
> configs loaded — no deprecation warns, boot log shows
> `policy=.theokit/hooks/shell-policy.md` + `workspace seeded: skills,
> hooks/, context/, wiki/`). Both MUST FIX edge cases verified by
> dedicated tests (3 path-traversal cases T3.2; atomic-write + pre-flight
> abort + timestamped backup T4.1).

> **Version 1.1** — Incorporates edge-case review (2 MUST FIX: EC-1 path-traversal guard em PLUGIN.md entry, EC-2 atomic write nas MD files do CLI; 9 SHOULD TEST baked nos TDD blocks; 10 DOCUMENT inline).
>
> **Version 1.0** — Migra os 2 configs file-based user-edited do SDK (`hooks.json`, `context.json`) + o per-plugin manifest (`plugins/<name>/plugin.json`) para o padrão **markdown + YAML frontmatter** (1 file = 1 entity), espelhando `skills/<name>/SKILL.md` que já é assim. Ganha comments inline, type-safe frontmatter via Zod (extensão do D10), per-entity git diff, parser reuse (`yaml-frontmatter.ts` já existe), e consistência com Claude Code / Cursor / Anthropic Skills. Backward-compat preservada via fallback loader: se o diretório markdown não existir, lê o JSON antigo com deprecation warn. Sunset em v2.0. CLI `theokit-migrate-config` faz a conversão automática. ADRs D74-D78. Saída: usuário pode `cat .theokit/hooks/shell-policy.md` e entender o porquê do hook, não só o quê.

## Context

### Estado atual (auditado 2026-05-18)

**Configs file-based no SDK:**

| Surface | Path atual | Consumidor | Edição manual |
|---|---|---|---|
| Hooks | `.theokit/hooks.json` (top-level) | `internal/runtime/hooks-loader.ts` (validação) + `hooks-executor.ts` (exec preToolUse) | sim |
| Context | `.theokit/context.json` (top-level) | `internal/runtime/context-manager.ts` | sim |
| Plugins (per-plugin) | `.theokit/plugins/<name>/plugin.json` | `internal/runtime/plugins-manager.ts` | sim |
| Skills (per-skill) | `.theokit/skills/<name>/SKILL.md` ✅ JÁ MARKDOWN | `internal/runtime/skills-manager.ts` + `skill-frontmatter.ts` | sim |
| Agent registry | `.theokit/agents/registry.json` | `internal/runtime/agent-registry-store.ts` | **não** (machine state) |
| MCP tokens | `~/.theokit/mcp-tokens.json` | `internal/mcp/token-storage.ts` | **não** (machine state) |

**False positive descoberto durante audit:** o `.theokit/plugins.json` (top-level) que aparece em `examples/telegram-pro/.theokit/` é seed-only — `examples/telegram-pro/src/workspace-seeds.ts:172` escreve, mas o SDK não lê. Portanto **NÃO é parte do escopo**.

**Evidence concreto do problema:**

1. Sem comments — `examples/telegram-pro/.theokit/hooks.json`:
   ```json
   {
     "hooks": {
       "preToolUse": [
         { "matcher": "^shell$", "command": "node .theokit/policy.js" }
       ]
     }
   }
   ```
   Por que esse matcher? Por que `policy.js` e não inline? Por que preToolUse? Nada documenta.

2. Skills JÁ usam o padrão markdown e funciona:
   ```markdown
   ---
   name: morning-routine
   description: Generate a personalized morning routine for the user...
   ---

   Before composing the routine, call memory_search(...)
   ```

3. Parser reusável existe em `internal/runtime/yaml-frontmatter.ts:1-20` (`parseSimpleYaml`) e `skill-frontmatter.ts:36-42` (`parseSkillFrontmatter` com schema Zod ADR D10).

4. Claude Code (`~/.claude/CLAUDE.md`, slash commands em `.md`) e Cursor (`.cursor/rules/*.md`) validam esse pattern.

### Por que isso é débito técnico real

- **Inconsistência interna**: `skills/<name>/SKILL.md` vs `hooks.json`/`context.json` — usuário aprende um padrão pra skills e outro pros configs.
- **Discoverability**: `ls .theokit/hooks/` lista hooks por nome; `cat hooks.json | jq '.hooks.preToolUse[].matcher'` não.
- **Per-entity git diff**: alterar um hook hoje muda o JSON inteiro; com 1-file-per-entity, diff isolado.
- **Sem type-safe frontmatter**: usuário pode escrever `"priority": "1"` (string) em plugin.json — erro só aparece em runtime. Frontmatter validado por Zod (D10 pattern) detecta na load.
- **Sem prose pra rationale**: o "porquê" do hook/plugin vira tribal knowledge.

## Objective

**Done quando:** todos os 3 configs user-edited do SDK (hooks, context, per-plugin manifest) suportam markdown + YAML frontmatter como formato canônico, o loader detecta MD-dir primeiro com fallback para JSON antigo (deprecation warn), e existe `theokit-migrate-config` CLI que converte automaticamente. Skills (que já são MD) seguem inalterados — servem de modelo.

Specific, measurable:

1. `.theokit/hooks/<name>.md` é o novo formato canônico para hooks; loader lê primeiro dele.
2. `.theokit/context/<name>.md` (ou `.theokit/context.md` consolidado) é o novo formato canônico para context sources.
3. `.theokit/plugins/<name>/PLUGIN.md` substitui `plugin.json` mantendo o per-folder shape (alinhamento com SKILL.md).
4. Schemas Zod tipam frontmatter pra cada categoria; erros surfaçam como `ConfigurationError` com códigos tipados (mesmo D10 pattern).
5. Backward-compat: se MD dir não existe, lê JSON antigo + emite warn `"[theokit-sdk] hooks.json is deprecated; migrate to .theokit/hooks/ — see theokit-migrate-config"`.
6. `theokit-migrate-config` CLI standalone em `packages/sdk/bin/` espelha `theokit-migrate-memory` (D44).
7. `examples/telegram-pro/.theokit/` migrado para o novo shape; serve de documentação executável.
8. `docs.md` ganha seção "Configuration files" mostrando o novo shape.
9. CI gate: novo loader test que exercita conversão (`.theokit/hooks.json` ↔ `.theokit/hooks/`) com property-based test (`fast-check`).
10. **Zero breaking change em v1.x**: o JSON loader continua funcional até v2.0 (sunset window de 1 major version).

## ADRs

### D74 — User-edited configs migram para markdown + YAML frontmatter

- **Decision:** Os 3 surfaces user-edited do SDK (hooks, context, per-plugin manifests) adotam o padrão markdown com YAML frontmatter, 1 file = 1 entity. Machine-state JSON (`registry.json`, `mcp-tokens.json`, `cron/jobs.json`) fica intacto.
- **Rationale:** Comments inline + per-entity git diff + Zod-typed frontmatter + parser reuse com SKILL.md + consistência com Claude Code/Cursor/Anthropic Skills marketplace. JSON é correto para machine state mas inadequado para configs que usuários hand-edit (sem comments, multi-line escapado, sem type safety). Alternativas rejeitadas: JSONC (parser dep extra sem ganho de prose body), TOML (nicho TS), TS config (`*.config.ts`, requer eval — segurança + portabilidade pior pra cross-language futuro). Markdown + frontmatter dá o melhor dos dois mundos: estruturado no frontmatter, prose no body.
- **Consequences:** Habilita self-documenting configs ("por que esse hook existe?" = prose body). Constrange: caller que faz "list all hooks" precisa ler dir em vez de array (mas listar dir é trivial). Constrange: 1 grande edit em N entities passa a ser N file edits — aceitável porque entities mudam isoladamente na prática.

### D75 — 1 file = 1 entity (não 1 file = N entities)

- **Decision:** Cada hook, cada context source, cada plugin é um arquivo separado em diretório dedicado (`.theokit/hooks/<name>.md`, etc.). NÃO usar 1 markdown único com N entities.
- **Rationale:** Per-entity git diff (mudar 1 hook não polui blame de outros 5), per-entity disable (renomear `<name>.md` → `<name>.md.disabled` desativa sem editar JSON), discoverability (`ls` lista). Espelha skills (`skills/<name>/SKILL.md`) e Claude Code commands (`~/.claude/commands/<name>.md`). Alternativa rejeitada: arquivo único `hooks.md` com sections — recria os problemas do JSON (blob diff, ordering matters, no isolation).
- **Consequences:** Habilita disable-by-rename. Constrange: bulk edit ("renomear todos os matchers") precisa script ou IDE multi-file edit. Aceitável — bulk edits em hooks são raros.

### D76 — Frontmatter validado por Zod schema, mesmo pattern de D10

- **Decision:** Schemas Zod tipam cada frontmatter category (HookFrontmatter, ContextSourceFrontmatter, PluginFrontmatter). Erros de schema surfaçam como `ConfigurationError` com códigos tipados (`hook_frontmatter_invalid`, `plugin_frontmatter_invalid`, etc.) — espelha D10 (`SkillFrontmatter`).
- **Rationale:** Type safety na load (detecta `"priority": "1"` ANTES de runtime). Reuso direto do `parseSimpleYaml` + abordagem D10 — código já testado em produção. Alternativa rejeitada: validação ad-hoc com `instanceof` checks — mais frágil, sem error context detalhado.
- **Consequences:** Habilita IDE intellisense (via JSON Schema gerado opcionalmente da Zod schema). Constrange: usuário precisa adivinhar fields se não houver exemplo — mitigado pelo CLI que escreve template comentado.

### D77 — Loader fallback: MD-dir primeiro, JSON com deprecation warn

- **Decision:** Cada loader checa primeiro pelo diretório MD (`hooks/`, `context/`, `plugins/<name>/PLUGIN.md`). Se existir e tiver pelo menos 1 entry, usa MD. Senão, fallback para `hooks.json` / `context.json` / `plugin.json` com warn one-time stderr: `"[theokit-sdk] {file}.json is deprecated; migrate to .theokit/{dir}/ via theokit-migrate-config"`. Se AMBOS existem, MD vence + warn `"both .theokit/hooks/ and .theokit/hooks.json detected — using markdown; remove hooks.json"`.
- **Rationale:** Zero breaking change em v1.x — usuários atuais continuam funcionando. Path de migração explícito (warn aponta pro CLI). Espelha o pattern do D54 (OAuth token cached only) que dá fallback gracioso.
- **Consequences:** Habilita migração em própria janela do usuário. Constrange: loader é ligeiramente mais complexo (2 paths). Mitigado: extrair helper `loadConfigWithFallback(mdDir, jsonPath, parser)` reusable nos 3 loaders.

### D78 — `theokit-migrate-config` CLI standalone

- **Decision:** Novo binary em `packages/sdk/bin/theokit-migrate-config.mjs` (espelhando D44 `theokit-migrate-memory`). Lê `.theokit/hooks.json` + `.theokit/context.json` + `.theokit/plugins/<name>/plugin.json`, escreve os arquivos MD correspondentes, faz backup do original (`<file>.json.bak`), valida o resultado round-trip. Dry-run default; `--apply` para escrever.
- **Rationale:** Conversão automática elimina migration friction. Espelha o pattern já estabelecido em D44 (SQLite→Lance) — usuário aprende um padrão e reusa. Alternativa rejeitada: snippet de código no docs.md — coloca trabalho no usuário, error-prone.
- **Consequences:** Habilita zero-effort migration. Constrange: precisa manter o CLI + seu bin entry no `package.json`. Aceitável — 1 file, ~200 LoC.

## Dependency Graph

```
Phase 0 ──▶ Phase 1 ──┬──▶ Phase 2 ──┬──▶ Phase 4 ──▶ Phase 5 ──▶ Final Dogfood
                      │              │
                      └──▶ Phase 3 ──┘

Phase 0 = Foundation: shared markdown-config loader + Zod schemas
Phase 1 = Hooks migration (highest-impact surface)
Phase 2 = Context migration (parallel-able with Phase 1)
Phase 3 = Plugin manifest migration (parallel-able with Phase 1)
Phase 4 = theokit-migrate-config CLI (depends on all 1-3 schemas)
Phase 5 = Docs + examples + CHANGELOG + CLAUDE.md
Final  = Dogfood QA — telegram-pro 25/25 + redaction unchanged + new MD configs working
```

- **Sequential blockers:** Phase 0 → all; Phase 4 → all schemas defined; Phase 5 → Phase 4.
- **Parallelizable:** Phases 1, 2, 3 podem rodar paralelo depois do Phase 0 (mesmo padrão, surfaces independentes).

---

## Phase 0: Foundation — shared markdown-config loader

**Objective:** Extrair / criar primitives reusáveis para os 3 loaders subsequentes não duplicarem código.

### T0.1 — Generalizar `parseSimpleYaml` para suportar listas + scalares tipados

#### Objective
Estender o parser existente em `internal/runtime/yaml-frontmatter.ts` para reconhecer listas `key: [a, b, c]` e scalars não-string (boolean, number) preservando type info, mantendo backward-compat com callers existentes (skills, subagents).

#### Evidence
Hoje `parseSimpleYaml` retorna `Record<string, string>` — todos values são strings. Skills usa `dependencies` como comma-separated string parseada downstream. Hooks/plugins precisam de `priority: 1` (number), `enabled: true` (boolean), `matchers: [a, b]` (string array) sem coerce manual em cada loader.

#### Files to edit
```
packages/sdk/src/internal/runtime/yaml-frontmatter.ts — extend parser to handle [list], booleans, numbers (mantendo string como default)
packages/sdk/src/internal/runtime/skill-frontmatter.ts — adaptar parseSkillFrontmatter para o novo retorno (cast onde necessário)
packages/sdk/src/internal/runtime/subagents-loader.ts — idem
packages/sdk/tests/internal/runtime/yaml-frontmatter.test.ts — (NEW) cobertura nova
```

#### Deep file dependency analysis
- `yaml-frontmatter.ts`: módulo tiny (20 LoC). Mudança: passar de `Record<string, string>` → `Record<string, string | number | boolean | string[]>`. Backward-compat: se valor não match boolean/number/list regex, fica string.
- `skill-frontmatter.ts`: faz casts `as string` em fields. Atualizar para tipos discriminados (usa `typeof` ou Zod parse downstream).
- `subagents-loader.ts`: similar a skill-frontmatter, single field consumption.

#### Deep Dives

**Algoritmo proposto:**

```typescript
type FrontmatterValue = string | number | boolean | string[];

export function parseSimpleYaml(text: string): Record<string, FrontmatterValue> {
  const fields: Record<string, FrontmatterValue> = {};
  for (const line of text.split(/\r?\n/)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    if (key.length === 0) continue;
    const raw = line.slice(colonIndex + 1).trim();
    fields[key] = coerce(raw);
  }
  return fields;
}

function coerce(raw: string): FrontmatterValue | undefined {
  if (raw.length === 0) return undefined;  // EC-3: empty value → undefined (Zod default kicks in)
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
  }
  if (raw === "true" || raw === "false") return raw === "true";
  const n = Number(raw);
  if (Number.isFinite(n) && raw === String(n)) return n;
  return raw;
}
```

**Edge cases:**
- EC-1: `name: 123` (key string) — preserva number type. Caller (Zod) coerce se quiser string.
- EC-2: `tags: []` — array vazio retorna `[]`.
- EC-3: `priority: 1.5` — float OK via `Number.isFinite`.
- EC-4: `description: A really, really long line` — comma dentro de string-livre (sem brackets) fica string única, OK.
- EC-5: `match: "1"` (string com aspas) — sem suporte a quoted strings, vira `"1"` literal (3 chars). Documentar como limitação do parser tiny.
- EC-6: backward compat — skill que tinha `name: foo` (string) continua string. Property test confirma.
- **EC-7 (edge-case review EC-3, MUST behavior)**: empty value `enabled:` (sem string após `:`) → `undefined` (NÃO `""`). Permite Zod `.optional().default(...)` aplicar. Sem isso, `""` chega no Zod boolean e rejeita.
- **DOCUMENT (edge-case review EC-12)**: lista NÃO suporta vírgula intencional em elemento. `tags: [a,b, c]` faz split por `,`; user que precisar literal `"a,b"` deve aceitar limitação ou usar single-quoted (quoted-strings ficam fora do escopo). JSDoc do `coerce()` documenta.

#### Tasks
1. Estender `parseSimpleYaml` com função `coerce()` helper.
2. Atualizar return type para `Record<string, FrontmatterValue>`.
3. Adaptar `parseSkillFrontmatter` para cast `string` onde apropriado (D10 schema force string).
4. Adaptar `subagents-loader.ts` similarmente.
5. Atualizar JSDoc explicando os 4 tipos suportados + limitação (sem quoted strings, sem nested objects).

#### TDD

```
RED: parseSimpleYaml("foo: bar") → { foo: "bar" } (backward compat)
RED: parseSimpleYaml("priority: 1") → { priority: 1 } (number)
RED: parseSimpleYaml("enabled: true") → { enabled: true } (boolean)
RED: parseSimpleYaml("enabled: false") → { enabled: false }
RED: parseSimpleYaml("tags: [a, b, c]") → { tags: ["a","b","c"] }
RED: parseSimpleYaml("tags: []") → { tags: [] }
RED: parseSimpleYaml("priority: 1.5") → { priority: 1.5 }
RED: parseSimpleYaml("description: long, comma, prose") → { description: "long, comma, prose" } (string fallback)
RED: parseSimpleYaml("name: 123") → { name: 123 } (number wins; caller coerce se quiser string)
RED: parseSimpleYaml("enabled:") → { enabled: undefined } — empty value (EC-3 fix; Zod default applies)
RED: existing skill frontmatter tests STILL pass (backward compat)
GREEN: implement coerce + update callers
REFACTOR: extract list/bool/number detectors if file complexity exceeds 50 LoC; otherwise inline
VERIFY: pnpm exec vitest run tests/internal/runtime/yaml-frontmatter.test.ts tests/internal/runtime/skill-frontmatter.test.ts
```

#### Acceptance Criteria
- [x] `parseSimpleYaml` retorna `Record<string, FrontmatterValue | undefined>` (string | number | boolean | string[] | undefined).
- [x] 10 RED tests pass (9 base + EC-3 empty-value).
- [x] Existing skills/subagents tests STILL pass (zero regression).
- [x] LoC `yaml-frontmatter.ts` <= 50.
- [x] Cyclomatic complexity `parseSimpleYaml` + `coerce` <= 10 combined.
- [x] Biome zero warnings.
- [x] `pnpm typecheck` clean.

#### DoD
- [x] Tasks 1-5 completed.
- [x] Tests green (`pnpm exec vitest run tests/internal/runtime`).
- [x] Zero typecheck errors.
- [x] Commit: `refactor(sdk): extend parseSimpleYaml with typed scalars + lists (T0.1)`.

---

### T0.2 — Criar `markdown-config-loader.ts` reusável

#### Objective
Helper genérico que: lê diretório de `.md` files, parseia frontmatter de cada, valida via Zod schema injetada, retorna array de entities tipadas. Loader pode ser reusado pelos 3 surfaces (hooks, context, plugins).

#### Evidence
Sem isso, cada surface duplica `readdir + readFile + parseSimpleYaml + Zod validate + error wrap` em ~50 LoC. Total dup: ~150 LoC. Helper resolve.

#### Files to edit
```
packages/sdk/src/internal/persistence/markdown-config-loader.ts — (NEW) shared helper
packages/sdk/tests/internal/persistence/markdown-config-loader.test.ts — (NEW)
```

#### Deep file dependency analysis
- `markdown-config-loader.ts` (NEW): zero inbound deps no início. Outbound: `parseSimpleYaml` (T0.1), `ConfigurationError`. Será consumido pelos loaders das Phases 1-3.

#### Deep Dives

**API proposta:**

```typescript
import type { z } from "zod";
import type { FrontmatterValue } from "../runtime/yaml-frontmatter.js";

export interface MarkdownEntity<T> {
  /** Slug from filename (without `.md`). */
  slug: string;
  /** Validated frontmatter. */
  frontmatter: T;
  /** Markdown body (everything after the second `---`). */
  body: string;
  /** Source absolute path for audit/error context. */
  source: string;
}

export interface LoadOptions<T> {
  /** Absolute path to the directory containing `*.md` files. */
  dir: string;
  /** Zod schema validating the frontmatter shape. */
  schema: z.ZodType<T>;
  /** Filename pattern (default: `*.md`; plugins use `PLUGIN.md` in subdirs). */
  pattern?: "flat" | "nested";
  /** Error code prefix (e.g., "hook" → "hook_frontmatter_invalid"). */
  errorCodePrefix: string;
}

export async function loadMarkdownEntities<T>(
  opts: LoadOptions<T>,
): Promise<MarkdownEntity<T>[]>;
```

**Algoritmo:**

```typescript
export async function loadMarkdownEntities<T>(opts: LoadOptions<T>): Promise<MarkdownEntity<T>[]> {
  const { dir, schema, pattern = "flat", errorCodePrefix } = opts;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ConfigurationError(`Failed to read ${dir}`, {
      code: `${errorCodePrefix}_dir_read_error`,
      cause,
    });
  }
  const out: MarkdownEntity<T>[] = [];
  for (const entry of entries) {
    const file = pattern === "flat"
      ? (entry.isFile() && entry.name.endsWith(".md") ? entry.name : null)
      : (entry.isDirectory() ? `${entry.name}/PLUGIN.md` : null);
    if (file === null) continue;
    const slug = pattern === "flat" ? entry.name.slice(0, -3) : entry.name;
    const source = join(dir, file);
    const raw = await readFile(source, "utf8").catch(() => null);
    if (raw === null) continue;
    const { frontmatter, body } = splitFrontmatter(raw, source, errorCodePrefix);
    const fields = parseSimpleYaml(frontmatter);
    const parsed = schema.safeParse(fields);
    if (!parsed.success) {
      throw new ConfigurationError(
        `Invalid frontmatter in ${source}: ${parsed.error.message}`,
        { code: `${errorCodePrefix}_frontmatter_invalid` },
      );
    }
    out.push({ slug, frontmatter: parsed.data, body: body.trim(), source });
  }
  return out;
}
```

**Edge cases:**
- EC-1 (dir não existe — `ENOENT`): return `[]` graciosamente.
- EC-2 (file sem frontmatter — sem `---` block): throw `<prefix>_missing_frontmatter`.
- EC-3 (frontmatter mal-formado YAML): caught por Zod schema; throw `<prefix>_frontmatter_invalid` com Zod error path.
- EC-4 (filename inválido `.md` mas vazio): slug `""` é rejected explicitamente.
- EC-5 (entry symlink): segue (readdir default behavior); documentado.
- EC-6 (nested pattern + subdir sem `PLUGIN.md`): silently skipped — não é plugin válido.
- EC-7 (body vazio): permitido — só frontmatter é OK pra hooks tipo `{matcher, command}` sem prose.
- **EC-8 (edge-case review EC-4): body markdown com `---` no meio NÃO confunde splitFrontmatter.** Algoritmo: só o PRIMEIRO bloco `---...---` no topo do arquivo é frontmatter. Outras ocorrências de `---` viram horizontal rule do markdown body.
- **EC-9 (edge-case review EC-5): `+++` (Hugo/TOML-style) rejeitado claramente** com `<prefix>_missing_frontmatter` (não detectar como delim alternativo).
- **EC-10 (edge-case review EC-6): frontmatter sem closing `---` (truncated)** — throw `<prefix>_missing_frontmatter` com mensagem "unterminated frontmatter block".
- **EC-11 (edge-case review EC-7): `EACCES` distinguido de `ENOENT`** — `EACCES` (chmod 000 na dir) lança `<prefix>_dir_read_error`; só `ENOENT` retorna `[]`.
- **DOCUMENT (edge-case review EC-13)**: filename collision case-insensitive em macOS/Windows (`Foo.md` ↔ `foo.md`). Plan note: "use lowercase slug convention for cross-platform safety".
- **DOCUMENT (edge-case review EC-14)**: file size cap não enforced. `.theokit/` é trusted source; readFile carrega tudo. Documentar em JSDoc.
- **DOCUMENT (edge-case review EC-15)**: dotfiles match pattern (`.gitkeep.md` matches). Convenção pra disable é renomear `<name>.md` → `<name>.md.disabled` (sufixo final, fora do `endsWith(".md")`).

#### Tasks
1. Criar `markdown-config-loader.ts` com `loadMarkdownEntities<T>`.
2. Helper privado `splitFrontmatter(raw, source, prefix)` que separa o bloco `---` do body.
3. Export `MarkdownEntity<T>` + `LoadOptions<T>` types.
4. JSDoc com 3 exemplos: flat (hooks), nested (plugins).

#### TDD

```
RED: loadMarkdownEntities({ dir: nonExistentPath, ... }) → [] (no throw)
RED: loadMarkdownEntities flat pattern with 3 .md files → 3 entities
RED: loadMarkdownEntities nested pattern with 2 subdirs each with PLUGIN.md → 2 entities
RED: loadMarkdownEntities with .md file lacking frontmatter --- → throws code "<prefix>_missing_frontmatter"
RED: loadMarkdownEntities with frontmatter missing required field → throws code "<prefix>_frontmatter_invalid"
RED: loadMarkdownEntities body extraction — trim() preserves prose, removes leading blank
RED: loadMarkdownEntities EC-6 — nested pattern skip subdir without PLUGIN.md
RED: loadMarkdownEntities EC-7 — body vazio OK
RED: body markdown com `---` horizontal-rule no meio NÃO é confundido com frontmatter end (EC-8 fix)
RED: arquivo com delim `+++` (Hugo) throws `<prefix>_missing_frontmatter` (EC-9 fix)
RED: arquivo `---\nname: foo\n` truncated (sem closing `---`) throws `<prefix>_missing_frontmatter` (EC-10 fix)
RED: chmod 000 na dir → readdir EACCES → throws `<prefix>_dir_read_error` (EC-11 fix; distinção de ENOENT)
GREEN: implement
REFACTOR: extract splitFrontmatter to standalone if reused outside; else inline
VERIFY: pnpm exec vitest run tests/internal/persistence/markdown-config-loader.test.ts
```

#### Acceptance Criteria
- [x] `loadMarkdownEntities<T>` exported from `internal/persistence/markdown-config-loader.ts`.
- [x] 12 RED tests pass (8 base + 4 edge-case review: EC-8/9/10/11).
- [x] `MarkdownEntity<T>` + `LoadOptions<T>` types exported (internal).
- [x] LoC <= 120.
- [x] Cyclomatic complexity `loadMarkdownEntities` <= 10.
- [x] Biome zero warnings.

#### DoD
- [x] Tasks 1-4 completed.
- [x] Tests green.
- [x] Commit: `feat(sdk): add markdown-config-loader helper (T0.2, ADR D74/D76)`.

---

## Phase 1: Hooks migration

**Objective:** `.theokit/hooks/<name>.md` é o formato canônico de hooks; loader detecta MD-dir primeiro com JSON fallback.

### T1.1 — Definir HookFrontmatter Zod schema

#### Objective
Schema Zod descrevendo o frontmatter de um hook file: `event` (enum), `matcher` (string regex), `command` (string), opcional `enabled`, `priority`.

#### Files to edit
```
packages/sdk/src/internal/runtime/hooks-frontmatter.ts — (NEW) Zod schema + parseHookFrontmatter wrapper
packages/sdk/tests/internal/runtime/hooks-frontmatter.test.ts — (NEW)
```

#### Deep Dives

**Schema:**

```typescript
import { z } from "zod";

export const HookFrontmatterSchema = z.object({
  event: z.enum(["preToolUse", "postToolUse"]),
  matcher: z.string().min(1),  // regex source (compiled at exec time)
  command: z.string().min(1),  // shell command to spawn
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().optional().default(0),
});

export type HookFrontmatter = z.infer<typeof HookFrontmatterSchema>;
```

**Edge cases:**
- EC-1: `event` faltando → Zod error. Required.
- EC-2: `matcher: ""` → Zod min(1) rejects.
- EC-3: `priority: "high"` (string) → Zod number rejects → "<prefix>_frontmatter_invalid" com path `priority`.
- EC-4: future event `onAgentSendStart` → adicionar ao enum em release subsequente; backward-compat (existing hooks com event="preToolUse" continuam OK).

#### Tasks
1. Criar `hooks-frontmatter.ts` com `HookFrontmatterSchema` + type export.
2. Wrapper helper `parseHookFrontmatter(raw, slug): HookFrontmatter` que coordena yaml-parser + Zod parse.

#### TDD

```
RED: HookFrontmatterSchema.safeParse({ event: "preToolUse", matcher: "^shell$", command: "node x.js" }) → success
RED: HookFrontmatterSchema rejects { event: "invalid" } → error path "event"
RED: HookFrontmatterSchema rejects { matcher: "" } → error min(1)
RED: HookFrontmatterSchema rejects { priority: "high" } → error number expected
RED: HookFrontmatterSchema defaults enabled=true, priority=0
RED: parseHookFrontmatter wraps Zod error em ConfigurationError com code "hook_frontmatter_invalid"
GREEN: implement
VERIFY: pnpm exec vitest run tests/internal/runtime/hooks-frontmatter
```

#### Acceptance Criteria
- [x] `HookFrontmatterSchema` + `HookFrontmatter` type exported.
- [x] 6 RED tests pass.
- [x] LoC <= 50.

#### DoD
- [x] Commit: `feat(sdk): add HookFrontmatter Zod schema (T1.1, ADR D76)`.

---

### T1.2 — Wirar markdown loader em hooks-loader + hooks-executor

#### Objective
Atualizar os 2 hook consumers (`hooks-loader.ts` validação, `hooks-executor.ts` exec) para detectar `.theokit/hooks/` primeiro; fallback para `hooks.json` com deprecation warn.

#### Files to edit
```
packages/sdk/src/internal/runtime/hooks-loader.ts — try MD dir first, fallback JSON with warn
packages/sdk/src/internal/runtime/hooks-executor.ts — same fallback strategy
packages/sdk/tests/internal/runtime/hooks-loader.test.ts — coverage da MD path + fallback
packages/sdk/tests/internal/runtime/hooks-executor.test.ts — coverage MD path
```

#### Deep Dives

**Algoritmo no loader:**

```typescript
export async function loadProjectHooks(cwd: string, settingSourcesIncludeProject: boolean) {
  if (!settingSourcesIncludeProject) return;
  const mdDir = join(cwd, ".theokit", "hooks");
  const jsonPath = join(cwd, ".theokit", "hooks.json");

  const mdEntities = await loadMarkdownEntities({
    dir: mdDir,
    schema: HookFrontmatterSchema,
    pattern: "flat",
    errorCodePrefix: "hook",
  });
  if (mdEntities.length > 0) {
    // ADR D77: warn if both exist
    if (existsSync(jsonPath)) {
      warnOnce(`[theokit-sdk] both .theokit/hooks/ and .theokit/hooks.json detected — using markdown; remove hooks.json`);
    }
    return; // MD wins, no JSON parse needed
  }
  // Fallback: JSON with deprecation warn
  if (existsSync(jsonPath)) {
    warnOnce(`[theokit-sdk] .theokit/hooks.json is deprecated; migrate to .theokit/hooks/<name>.md via theokit-migrate-config`);
    // ... existing JSON parse logic ...
  }
}
```

**Edge cases:**
- EC-1: ambos existem → MD vence; warn pro user remover JSON. Não throw.
- EC-2: nenhum existe → loader retorna OK (sem hooks). Behavior atual mantido.
- EC-3: MD dir existe mas vazio → `mdEntities.length === 0` → fallback JSON. Documenta como "empty markdown dir is treated as no markdown source".
- EC-4: warnOnce dedup — `Set<string>` no module scope previne flood se loader chamado N vezes (cron + send + skills).
- **DOCUMENT (edge-case review EC-16)**: bot long-running + CLI migration → bot fica com config antiga em memória. Documentar em docs.md migration section: "restart bot after running theokit-migrate-config" (mesmo problema do JSON hot-edit hoje, não é regression).
- **DOCUMENT (edge-case review EC-18)**: spawned workers (cron, subagent) são new process → warnOnce reset → warn re-emite. Aceitável (1 warn por process boot, não por call). JSDoc do warnOnce documenta.

#### Tasks
1. Importar `loadMarkdownEntities` + `HookFrontmatterSchema` em `hooks-loader.ts`.
2. Adicionar `warnOnce(message)` helper (ou reusar se já existir em `internal/util`).
3. Implementar fallback chain MD → JSON com warns.
4. Replicar em `hooks-executor.ts` — DRY via shared loader? **DRY decision**: extrair `loadHookConfig(cwd)` em novo helper `hooks-source.ts` consumido por ambos. Hooks-loader valida, hooks-executor consome.
5. Atualizar tests existentes pra cobrir MD path.

#### TDD

```
RED: loadProjectHooks reads .theokit/hooks/shell-policy.md → no error, validation passes
RED: loadProjectHooks fallback to hooks.json when hooks/ doesn't exist → warn emitted (capture stderr) + parses OK
RED: loadProjectHooks both hooks/ and hooks.json → MD wins, warn about removing JSON
RED: loadProjectHooks empty hooks/ dir → falls back to hooks.json
RED: hooks-executor receives same MD-first path
RED: warnOnce dedupes — same warning across 3 loadProjectHooks calls = 1 stderr line
GREEN: implement chain + shared loader
REFACTOR: extract loadHookConfig() if duplicated between loader + executor
VERIFY: pnpm exec vitest run tests/internal/runtime/hooks-{loader,executor}
```

#### Acceptance Criteria
- [x] hooks-loader.ts detects MD-first.
- [x] hooks-executor.ts same path.
- [x] 6 RED tests pass.
- [x] Existing hooks tests pass (zero regression).
- [x] Deprecation warn emitted to stderr on JSON path.
- [x] No double-warn (warnOnce semantics).
- [x] Biome zero warnings.

#### DoD
- [x] Commit: `feat(sdk): markdown hooks loader with JSON fallback (T1.2, ADR D77)`.

---

## Phase 2: Context migration

**Objective:** `.theokit/context/<source>.md` (ou `.theokit/context.md` consolidado) substitui `context.json` no context-manager.

### T2.1 — Definir ContextSourceFrontmatter schema + decision sobre shape

#### Objective
Decidir: 1 file per source (`context/<name>.md`) OU 1 consolidated file (`context.md`). Definir Zod schema.

#### Evidence
Hoje `context.json` é um array de `{name, path}` simples — geralmente 1-5 sources. 1 file per source aumenta file count sem ganho proporcional. Mas single file `context.md` recria o problema de JSON (blob diff).

**Decisão (em ADR D75 acima):** seguir pattern 1-file-per-entity. Mesmo que context tenha tipicamente 3-5 sources, o ganho de consistência com hooks/plugins é maior que o overhead de 5 arquivos. Documentar prose body explicando "por que esse source é parte do contexto".

#### Files to edit
```
packages/sdk/src/internal/runtime/context-frontmatter.ts — (NEW) ContextSourceFrontmatterSchema
packages/sdk/tests/internal/runtime/context-frontmatter.test.ts — (NEW)
```

#### Deep Dives

**Schema:**

```typescript
import { z } from "zod";

export const ContextSourceFrontmatterSchema = z.object({
  name: z.string().min(1),  // identifier; defaults to filename slug if omitted
  path: z.string().min(1),  // file path relative to cwd, OR `inline:` body
  // Future-compat:
  enabled: z.boolean().optional().default(true),
  maxTokens: z.number().int().positive().optional(),
});

export type ContextSourceFrontmatter = z.infer<typeof ContextSourceFrontmatterSchema>;
```

#### Tasks
1. Criar `context-frontmatter.ts` com schema + type.
2. Wrapper `parseContextSourceFrontmatter` espelhando o de hooks.

#### TDD

```
RED: ContextSourceFrontmatterSchema.safeParse({ name: "readme", path: "README.md" }) → success
RED: rejects { path: "" } (empty)
RED: rejects { maxTokens: -1 } (non-positive)
RED: defaults enabled=true
GREEN: implement
VERIFY: pnpm exec vitest run tests/internal/runtime/context-frontmatter
```

#### Acceptance Criteria
- [x] Schema exported, 4 RED tests pass.

#### DoD
- [x] Commit: `feat(sdk): add ContextSourceFrontmatter schema (T2.1, ADR D76)`.

---

### T2.2 — Wirar markdown loader em context-manager

#### Objective
Atualizar `internal/runtime/context-manager.ts:refresh()` para tentar `.theokit/context/<name>.md` primeiro; fallback `context.json`.

#### Files to edit
```
packages/sdk/src/internal/runtime/context-manager.ts — refresh() detects MD dir first
packages/sdk/tests/internal/runtime/context-manager.test.ts — coverage
```

#### Deep file dependency analysis
- `context-manager.ts:refresh()` (linha 60-80) hoje só lê `context.json`. Mudança concentrada na função. Caller (`Agent.create`) passa por aqui ao boot.

#### Deep Dives

**Mudança no refresh():**

```typescript
async refresh(): Promise<void> {
  const mdDir = join(this.cwd, ".theokit", "context");
  const mdEntities = await loadMarkdownEntities({
    dir: mdDir,
    schema: ContextSourceFrontmatterSchema,
    pattern: "flat",
    errorCodePrefix: "context",
  });
  let config: ContextConfig;
  if (mdEntities.length > 0) {
    config = {
      sources: mdEntities
        .filter(e => e.frontmatter.enabled !== false)
        .map(e => ({ name: e.frontmatter.name ?? e.slug, path: e.frontmatter.path })),
    };
  } else {
    // Fallback JSON path (existing logic, no behavioral change)
    config = await loadJsonConfig(this.cwd);
    if (config.sources.length > 0) {
      warnOnce(`[theokit-sdk] .theokit/context.json is deprecated; migrate to .theokit/context/<name>.md`);
    }
  }
  const loadedSources = await loadSources(config, this.cwd);
  this.state = { config, loadedSources };
}
```

#### Tasks
1. Importar `loadMarkdownEntities` + `ContextSourceFrontmatterSchema`.
2. Refatorar `refresh()` com fallback chain.
3. Cobrir tests existentes pra MD path.

**DOCUMENT (edge-case review EC-17)**: se user desabilita TODOS context sources via rename (`<name>.md` → `<name>.md.disabled`), `mdEntities.length === 0` → fallback pra JSON (se existir) ou no-op. Para evitar confusão "disable não funcionou", emit info-level warn "all context sources disabled" quando `.md.disabled` files existem mas zero `.md`. Documentar disable convention em docs.md.

#### TDD

```
RED: ContextManager.refresh reads context/readme.md → sources include {name, path}
RED: ContextManager.refresh fallback to context.json with warn
RED: ContextManager.refresh both → MD wins
RED: ContextSourceFrontmatter `enabled: false` excludes from config.sources
GREEN: implement
VERIFY: pnpm exec vitest run tests/internal/runtime/context-manager
```

#### Acceptance Criteria
- [x] 4 RED tests pass.
- [x] Existing context-manager tests pass.
- [x] Biome zero warnings.

#### DoD
- [x] Commit: `feat(sdk): markdown context-manager with JSON fallback (T2.2, ADR D77)`.

---

## Phase 3: Plugin manifest migration

**Objective:** `.theokit/plugins/<name>/PLUGIN.md` (frontmatter + prose) substitui `plugin.json`.

### T3.1 — Definir PluginFrontmatter schema

#### Objective
Schema cobrindo plugin manifest: `name`, `type` (enum), `entry` (relative path), `provider` (object opcional pra provider plugins), e seu metadata.

#### Files to edit
```
packages/sdk/src/internal/runtime/plugin-frontmatter.ts — (NEW)
packages/sdk/tests/internal/runtime/plugin-frontmatter.test.ts — (NEW)
```

#### Deep Dives

**Schema:**

```typescript
import { z } from "zod";

export const PluginFrontmatterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["provider", "tool", "cron"]),
  entry: z.string().min(1),  // relative path to JS entry, e.g., "index.js"
  // Provider-specific fields (parseado downstream se type=provider)
  providerId: z.string().optional(),
  providerCapability: z.enum(["chat", "embedding", "vision"]).optional(),
  providerPriority: z.number().int().nonnegative().optional(),
  version: z.string().optional(),
});
```

**Por que flat (não nested object pra provider):** parseSimpleYaml não suporta nested objects. Manter shape flat com prefixos `providerId/providerCapability/providerPriority`. Caller (plugins-manager) reagrupa em `{ provider: { id, capability, priority } }` se `type === "provider"`.

#### Tasks
1. Schema + reagrupar helper.

#### TDD

```
RED: PluginFrontmatterSchema.safeParse({ name, type: "provider", entry, providerId, providerCapability, providerPriority }) → success
RED: rejects unknown type
RED: rejects entry: ""
RED: helper reagrupa flat → { provider: { id, capability, priority } } when type=provider
GREEN: implement
VERIFY: tests
```

#### Acceptance Criteria
- [x] 4 RED tests pass, schema exported.

#### DoD
- [x] Commit: `feat(sdk): add PluginFrontmatter schema (T3.1, ADR D76)`.

---

### T3.2 — Wirar plugins-manager para ler PLUGIN.md primeiro

#### Objective
Atualizar `plugins-manager.ts` (linhas 47-60) para tentar `.theokit/plugins/<name>/PLUGIN.md` antes de `plugin.json`.

#### Files to edit
```
packages/sdk/src/internal/runtime/plugins-manager.ts — MD-first, JSON fallback
packages/sdk/tests/internal/runtime/plugins-manager.test.ts — coverage
```

#### Tasks
1. Replicar pattern de hooks-loader: tentar PLUGIN.md, se sucesso usar; senão fallback plugin.json com warn.
2. Mantém `plugins/<name>/<entry>` (entry file is JS, não muda).
3. **(EC-1 MUST FIX)** Adicionar path-traversal guard ANTES do `join`. Validar `entry` recusando segments `..` ou caminhos absolutos:
   ```typescript
   if (parsed.entry.includes("..") || isAbsolute(parsed.entry)) {
     throw new ConfigurationError(
       `Plugin ${folderName} entry escapes plugin dir`,
       { code: "plugin_entry_escape" },
     );
   }
   ```
   Aplicar tanto no path PLUGIN.md QUANTO no path JSON fallback — same guard, ambos vectors.

#### TDD

```
RED: plugins-manager loads from plugins/openrouter/PLUGIN.md → metadata correto
RED: fallback to plugins/openrouter/plugin.json com warn
RED: both files → MD wins
RED: missing entry JS file → throws "plugin_entry_missing" (mantém behavior)
RED: PLUGIN.md com entry: "../../etc/passwd" → throws "plugin_entry_escape" (EC-1 fix)
RED: PLUGIN.md com entry: "/abs/path.js" → throws "plugin_entry_escape" (EC-1 fix)
RED: plugin.json fallback com entry traversal → throws "plugin_entry_escape" (mesma guard no JSON path)
GREEN: implement
VERIFY: tests
```

#### Acceptance Criteria
- [x] 7 RED tests pass (4 base + 3 path-traversal EC-1).
- [x] Existing plugins tests pass.
- [x] `plugin_entry_escape` error code adicionado ao `ErrorCode` enum (errors.ts) se ainda não existir.

#### DoD
- [x] Commit: `feat(sdk): markdown plugin manifest + path-traversal guard (T3.2, ADR D77 + EC-1 fix)`.

---

## Phase 4: `theokit-migrate-config` CLI

**Objective:** Standalone CLI que converte JSONs antigos pra MD files; espelha o pattern de `theokit-migrate-memory` (D44).

### T4.1 — Implementar CLI

#### Files to edit
```
packages/sdk/bin/theokit-migrate-config.mjs — (NEW) standalone CLI
packages/sdk/package.json — add bin entry "theokit-migrate-config"
packages/sdk/tests/internal/migrate-config.test.ts — (NEW) round-trip test
```

#### Deep Dives

**CLI interface:**

```
theokit-migrate-config [--cwd <path>] [--apply] [--no-backup]

Default: dry-run. Detects .theokit/hooks.json, context.json, plugins/<name>/plugin.json.
Writes corresponding markdown files. With --apply, writes; otherwise prints diff.
With --backup (default), original JSON renamed to <file>.json.bak before migration.
```

**Algoritmo:**

1. Read `<cwd>/.theokit/hooks.json` → parse → for each hook, write `<cwd>/.theokit/hooks/<slug>.md` with frontmatter + auto-generated prose body (placeholder: "TODO: explain why this hook exists.") via **atomic write** (tmpfile + rename, ADR D59 pattern).
2. Read `<cwd>/.theokit/context.json` → for each source, write `<cwd>/.theokit/context/<slug>.md` via atomic write.
3. Read `<cwd>/.theokit/plugins/<name>/plugin.json` (glob) → for each, write `<cwd>/.theokit/plugins/<name>/PLUGIN.md` via atomic write.
4. Backup originals: rename `.json` → `.json.<unix-ts>.bak` (timestamp suffix, EC-19 fix — re-runs do CLI não sobrescrevem backup anterior).
5. Validate round-trip: load via new loaders, assert metadata matches original JSON (deep-equal modulo Zod defaults).
6. **(EC-9 fix)** Pre-flight check: se algum MD file destino JÁ EXISTE (não criado pelo CLI nesta run), ABORT com mensagem "MD already populated at <path>; remove or merge manually before re-running". Prevent overwrite de edits manuais.

#### Tasks
1. CLI arg parsing (manual; no commander dep — match D44 style).
2. Round-trip validation.
3. **(EC-19 fix)** Backup com timestamp suffix `.<unix-ts>.bak` em vez de `.bak` (preserva backup history em re-runs).
4. **(EC-2 MUST FIX)** Criar `atomicWriteText(path, content)` em `internal/persistence/atomic-write.ts` (espelhando `atomicWriteJson`); CLI usa este helper pra escrita de cada `.md`. Crash mid-write → previous MD files OK + tmpfile órfão (cleanup-on-startup ou ignorado).
5. **(EC-9 fix)** Pre-flight check: se `<cwd>/.theokit/{hooks,context}/<slug>.md` existir ANTES da run, abort com mensagem clara.

#### TDD

```
RED: migrate-config on tmpdir com hooks.json + context.json → produces matching .md files
RED: --apply false (default) prints diff, doesn't write
RED: --apply true writes + backs up com timestamp suffix (EC-19 fix)
RED: round-trip validation fails on shape mismatch → exit code 1 + helpful error
RED: --no-backup skips .bak rename
RED: idempotent — running 2× é safe (warns "already migrated, .<ts>.bak exists")
RED: workspace SEM .theokit/ → exit 0 com "nothing to migrate" (EC-8 fix)
RED: workspace COM .theokit/hooks/<name>.md PRE-EXISTENTE → abort com mensagem clara (EC-9 fix)
RED: 2 backups consecutivos preservados (EC-19 fix; timestamps diferentes)
RED: atomic write — kill mid-write não corrompe MD files previous (EC-2 fix; usar SIGKILL em sub-process test)
GREEN: implement
VERIFY: tests/internal/migrate-config
```

**DOCUMENT (edge-case review EC-20)**: round-trip validation cobre só o que CLI escreveu. Pre-existing MD files (sem JSON correspondente) são preservados sem validação adicional. Se user editou MD manualmente com frontmatter inválido, descoberto no boot do SDK (não no CLI).

#### Acceptance Criteria
- [x] CLI runs standalone via `npx theokit-migrate-config`.
- [x] 10 RED tests pass (6 base + EC-2/8/9/19).
- [x] Round-trip validation passes on telegram-pro real .theokit/.
- [x] `atomicWriteText` exported from `internal/persistence/atomic-write.ts`.

#### DoD
- [x] Commit: `feat(sdk): theokit-migrate-config CLI (T4.1, ADR D78)`.

---

## Phase 5: Docs + examples + roadmap sync

### T5.1 — Migrar examples/telegram-pro/.theokit/ pra markdown

#### Objective
Após CLI funcionar, rodar nele em `telegram-pro` e commit do resultado.

#### Files to edit
```
examples/telegram-pro/.theokit/hooks/<name>.md — (NEW per hook)
examples/telegram-pro/.theokit/context/<name>.md — (NEW per source)
examples/telegram-pro/.theokit/hooks.json — DELETE (após backup verificado)
examples/telegram-pro/.theokit/context.json — DELETE
examples/telegram-pro/src/workspace-seeds.ts — update seeds to write MD files
```

#### Tasks
1. Rodar `theokit-migrate-config --apply` em telegram-pro workspace.
2. Adicionar prose bodies meaningful nos MD files (não placeholder).
3. Atualizar `workspace-seeds.ts` pra escrever MD (não JSON).
4. Validar dogfood: `pnpm validate` + telegram-pro dogfood ainda passam.

#### TDD

```
RED: workspace-seeds.ts writes .theokit/hooks/shell-policy.md (not hooks.json)
RED: bot startup logs "workspace seeded: skills, hooks/, context/, wiki/" (não plugins.json)
RED: live telegram-pro dogfood 25/25 PASS (sem regressão)
RED: workspace-seeds idempotente — rodar 2× NÃO sobrescreve MD files com user edits (EC-10 fix via ensureFile semantic preservado)
GREEN: migrate via CLI + manual prose enrichment
VERIFY: dogfood live
```

#### Acceptance Criteria
- [x] 4 RED tests pass (3 base + EC-10 idempotence).
- [x] hooks.json + context.json removidos do telegram-pro workspace.

#### DoD
- [x] Commit: `chore(telegram-pro): migrate .theokit/ to markdown configs (T5.1)`.

---

### T5.2 — docs.md + CHANGELOG + CLAUDE.md sync

#### Files to edit
```
docs.md — new "Configuration files" section showing MD shape; deprecation note for JSON
packages/sdk/CHANGELOG.md — entry under [Unreleased]
CLAUDE.md — add ADR rows D74-D78, update macro roadmap (closes 1 item from "config format" debt)
.claude/knowledge-base/sdk-references/README.md — sync if pattern added to roadmap
```

#### Tasks
1. docs.md: nova seção "Configuration files" com:
   - shape MD canonical + 1 example completo por surface (hook, context source, plugin manifest)
   - deprecation note + `theokit-migrate-config` reference
   - schema reference (Zod source link)
2. CHANGELOG entry: Added (markdown configs) + Deprecated (JSON configs com sunset window).
3. CLAUDE.md: 5 ADR rows D74-D78 na ADR table.
4. **(EC-11 fix)** Adicionar lint test `tests/lint/no-legacy-json-config-refs.test.ts` que grep `docs.md` por refs ativas a `hooks.json`/`context.json` (excluindo deprecation note). Pattern espelha `tests/lint/no-hardcoded-theokit-path.test.ts`.
5. **(EC-21 fix)** CHANGELOG entry explicitamente declara timeline:
   - "Deprecated in v1.5 (one-time stderr warn on JSON load).
   - "Removed in v2.0 (planned Q2 2027) — JSON loader path will be deleted; users must migrate via theokit-migrate-config before v2.0."

#### TDD

```
RED: no-legacy-json-config-refs lint test — grep docs.md por hooks.json/context.json em contextos não-deprecation → zero hits (EC-11 fix)
RED: CHANGELOG diff inclui linha "Deprecated in v1.5, removed in v2.0 (planned Q2 2027)" (EC-21 fix)
GREEN: aplicar T5.2 task 4 + 5
VERIFY: lint test green
```

#### Acceptance Criteria
- [x] docs.md section reviewed.
- [x] CHANGELOG entry includes deprecation timeline explícito (v1.5 warn, v2.0 remove planned Q2 2027).
- [x] CLAUDE.md ADR table updated.
- [x] Lint test `no-legacy-json-config-refs` passa (zero active refs ao JSON legacy em docs.md).

#### DoD
- [x] Commit: `docs(sdk): document markdown configs + migration path (T5.2)`.

---

### T5.3 — ADRs D74-D78 commitados

#### Files to edit
```
.claude/knowledge-base/adrs/D74-config-markdown-format.md — (NEW)
.claude/knowledge-base/adrs/D75-one-file-one-entity.md — (NEW)
.claude/knowledge-base/adrs/D76-frontmatter-zod-schema.md — (NEW)
.claude/knowledge-base/adrs/D77-md-first-json-fallback.md — (NEW)
.claude/knowledge-base/adrs/D78-migrate-config-cli.md — (NEW)
```

#### Acceptance Criteria
- [x] 5 ADR files com Decision / Rationale / Consequences cada.

#### DoD
- [x] Commit: `docs(sdk): add ADRs D74-D78 for markdown config migration (T5.3)`.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Sem comments em hooks.json/context.json/plugin.json | T1.2, T2.2, T3.2 | Prose body do markdown |
| 2 | Inconsistência com SKILL.md (skills usam MD, configs usam JSON) | T0.2, T1.2, T2.2, T3.2 | Mesmo padrão markdown + frontmatter |
| 3 | Sem per-entity git diff | T0.2 (loadMarkdownEntities flat pattern) | 1 file per entity |
| 4 | Sem type-safe frontmatter | T1.1, T2.1, T3.1 (Zod schemas) | Schema validation na load |
| 5 | Sem discoverability (cat array vs ls dir) | T0.2 + T1.2 + T2.2 + T3.2 | `ls .theokit/hooks/` etc. |
| 6 | Migração manual painful | T4.1 | CLI automatiza |
| 7 | Breaking change risk | T1.2, T2.2, T3.2 (fallback) | MD-first com JSON fallback |
| 8 | Examples ficam com formato antigo | T5.1 | telegram-pro migrado |
| 9 | Docs sem novo shape | T5.2 | docs.md updated |
| 10 | Rationale arquitetural não capturado | T5.3 | ADRs D74-D78 |
| 11 | parseSimpleYaml não suporta numbers/booleans/lists | T0.1 | Extension com coerce |
| 12 | Code dup entre 3 loaders | T0.2 | Shared loadMarkdownEntities |
| 13 | Workspace-seeds escreve JSON, mismatch com novo loader | T5.1 | Update seeds para MD |
| 14 | Round-trip validation precisa | T4.1 | CLI valida JSON↔MD shape |
| 15 | Edge-case review EC-1: path traversal em PLUGIN.md entry | T3.2 (3 RED tests + guard) | `if (entry.includes("..") \|\| isAbsolute(entry)) throw plugin_entry_escape` |
| 16 | Edge-case review EC-2: CLI crash mid-write corrompe MD | T4.1 (atomic write via tmpfile+rename) | Helper `atomicWriteText` reusa pattern de `atomicWriteJson` |
| 17 | Edge-case review EC-3: empty value `enabled:` | T0.1 (coerce returns undefined) | `if (raw.length === 0) return undefined` |
| 18 | Edge-case review EC-4: body markdown com `---` confunde splitter | T0.2 (only first `---...---` block at file head) | 1 RED test |
| 19 | Edge-case review EC-5/6: `+++` ou truncated frontmatter | T0.2 (claro throw `missing_frontmatter`) | 2 RED tests |
| 20 | Edge-case review EC-7: EACCES distinguido de ENOENT | T0.2 (throw `<prefix>_dir_read_error` em EACCES) | 1 RED test |
| 21 | Edge-case review EC-8: CLI em workspace vazio | T4.1 (graceful "nothing to migrate") | 1 RED test |
| 22 | Edge-case review EC-9: CLI re-run quando MD parcial existe | T4.1 (pre-flight abort) | 1 RED test + plan task 6 |
| 23 | Edge-case review EC-10: workspace-seeds idempotence | T5.1 (ensureFile semantic preservado) | 1 RED test |
| 24 | Edge-case review EC-11: docs.md sem refs ativas a JSON | T5.2 (lint test) | grep-based test |
| 25 | Edge-case review EC-12-21: documentação de risks aceitos | T0.1, T0.2, T1.2, T2.2, T4.1, T5.2 (inline notes) | JSDoc + plan notes |

**Coverage: 25/25 gaps covered (100%)**

## Global Definition of Done

- [x] All phases (0-5) completed.
- [x] All tests passing (`pnpm test`).
- [x] Zero biome warnings em arquivos plan-touched.
- [x] Zero typecheck errors.
- [x] Backward compatibility preserved: hooks.json + context.json + plugin.json continuam funcionando até v2.0 com deprecation warn.
- [x] CHANGELOG.md atualizado com Added + Deprecated entries.
- [x] docs.md "Configuration files" section adicionada.
- [x] CLAUDE.md ADR table tem rows D74-D78.
- [x] 5 ADRs commitados em `.claude/knowledge-base/adrs/`.
- [x] `theokit-migrate-config` CLI funcional em `packages/sdk/bin/`.
- [x] `examples/telegram-pro/.theokit/` migrado.
- [x] **Runtime-metric proof**: `loadMarkdownEntities` é called e retorna >0 entities num workload real (telegram-pro live dogfood); JSON fallback path é exercitado por test mas warn é observed em log.
- [x] **Dogfood QA PASS** — telegram-pro 25/25 mantido + zero regressão de redação + bot log mostra new MD-loader works.

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Validar que os 3 surfaces migrados funcionam end-to-end via telegram-pro real, e que o fallback JSON path também funciona quando MD não existe.

### Execution

1. Rodar `theokit-migrate-config --apply` em telegram-pro workspace.
2. Restart bot, rodar live CDP dogfood (`telegram-pro-dogfood` skill).
3. Assertar 25/25 PASS (mesmo critério dos planos anteriores).
4. Test manual: deletar `.theokit/hooks/` (force JSON fallback), restart, confirmar warn em stderr + bot ainda boota.
5. Test manual: criar conflito (MD + JSON ambos presentes), confirmar warn "remove hooks.json" + MD wins.

### Acceptance Criteria

- [x] 25/25 PASS mantido em live CDP dogfood.
- [x] Bot log mostra `workspace seeded: skills, hooks/, context/, wiki/` (não `hooks.json`).
- [x] Deletando `.theokit/hooks/` e bootando: stderr tem deprecation warn + bot funciona.
- [x] MD + JSON ambos: warn "remove hooks.json" + bot funciona.
- [x] Zero CRITICAL issues introduzidos.
- [x] Health score >= 70/100.

### If Dogfood Fails

1. Identificar quais issues são causados pelas mudanças deste plano.
2. Fix all CRITICAL/HIGH antes de declarar completo.
3. Re-run dogfood.

## References

- Specs primárias: nenhuma direta em sdk-references (este plano é novo formato, não pattern Hermes).
- Parser reuse: [`internal/runtime/yaml-frontmatter.ts`](../../../packages/sdk/src/internal/runtime/yaml-frontmatter.ts), [`skill-frontmatter.ts`](../../../packages/sdk/src/internal/runtime/skill-frontmatter.ts).
- Migration CLI pattern: ADR D44 (`theokit-migrate-memory`).
- Frontmatter schema pattern: ADR D10 (Skill frontmatter Zod).
- Macro roadmap: `CLAUDE.md` § "Macro Roadmap" — encaixa em Tier 1.5 (entre quick wins e architecture).
- Claude Code parallel: `~/.claude/CLAUDE.md`, `~/.claude/commands/*.md`, `~/.claude/skills/*.md`.
- Cursor parallel: `.cursor/rules/*.md`.
- Anthropic Skills marketplace parallel: skill-style markdown packages.
