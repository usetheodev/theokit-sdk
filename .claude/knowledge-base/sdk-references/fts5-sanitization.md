# FTS5 Query Sanitization

> Input do usuário NUNCA vai direto pro `MATCH` clause do FTS5. Um
> 6-step sanitizer preserva phrase search, escapa dotted/hyphenated
> identifiers, e remove boolean operators dangling. Sem isso, queries
> como `error-code` ou `P2.2` ou `auth_token` parseiam errado ou
> lançam exception em runtime.

## Quando aplicar

Aplique sempre que estiver fazendo full-text search via SQLite FTS5:

- Cross-session message search (`Memory.searchAllSessions`)
- Skill content search
- Wiki entry search
- Qualquer feature que aceita user query → FTS5

Não aplique para:

- Search por `LIKE` (sanitizer é específico do FTS5 syntax)
- Vector search (embedding pipeline tem own sanitization)
- Equality lookups (`WHERE id = ?`)

## Por que importa

Hermes FTS5 sanitizer foi corrigido **10 vezes** desde v0.2:

| PR | Versão | Fix |
|---|---|---|
| #1776 | v0.4 | Hyphenated queries parsing |
| #1892 | v0.4 | Search-all-sources default |
| #1744 | v0.4 | Corrupt `load_transcript` lines |
| #2157 | v0.4 | Case-sensitive duplicates |
| #2194 | v0.4 | No-sessions crash |
| #4549 | v0.7 | Quote dotted terms |
| #16915 | v0.12 | Quote underscored terms |
| #16651 | v0.12 | Trigram CJK index |
| #16914 | v0.12 | Index `tool_name`+`tool_calls` |
| #16914 | v0.12 | Repair-and-migrate FTS5 schema drift |

Cada um foi um crash em produção. Sanitizer maduro evita re-encontrar
todos eles.

## Os 6 steps (do `hermes_state.py:1797-1847`)

### Step 1: Preserve quoted phrases

Extrai `"phrases quoted"` para placeholders. Senão, steps subsequentes
mutilam phrases ("DROP TABLE" vira `DROP AND TABLE`).

```python
phrases = []
def _capture(m):
    phrases.append(m.group(0))
    return f"__PHRASE_{len(phrases)-1}__"

text = re.sub(r'"[^"]+"', _capture, query)
```

### Step 2: Strip unmatched specials

Remove `[`, `]`, `{`, `}`, `(`, `)`, `^`, `"` órfãos. FTS5 rejeita esses
sozinhos.

```python
text = re.sub(r"[\[\]\{\}()\"^]", " ", text)
```

### Step 3: Collapse repeated asterisks

`**` → `*` (FTS5 não suporta `**`). Preserva 1 asterisco para prefix
query (`auth*`).

```python
text = re.sub(r"\*+", "*", text)
```

### Step 4: Strip dangling boolean operators

`AND OR` no início/fim sem operando. Senão FTS5 falha com
`syntax error near "AND"`.

```python
text = re.sub(r"^\s*(AND|OR|NOT)\s+", "", text, flags=re.IGNORECASE)
text = re.sub(r"\s+(AND|OR|NOT)\s*$", "", text, flags=re.IGNORECASE)
```

### Step 5: Wrap dotted/hyphenated identifiers in quotes

`error-code` sem quotes vira `error AND code` (FTS5 token splitting).
Mesmo problema com `P2.2`, `tools_v1`, `auth_token`.

```python
# Match identifier with dots/hyphens/underscores
def _quote_special(m):
    return f'"{m.group(0)}"'
text = re.sub(r"\b[\w]+[\-\.\_][\w\-\.\_]+\b", _quote_special, text)
```

### Step 6: Restore preserved phrases

```python
for i, phrase in enumerate(phrases):
    text = text.replace(f"__PHRASE_{i}__", phrase)
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/session-db/sanitize-fts5.ts
export function sanitizeFts5Query(query: string): string {
  if (query.length === 0) return query;

  // Step 1: preserve "quoted phrases"
  const phrases: string[] = [];
  let text = query.replace(/"[^"]+"/g, (match) => {
    phrases.push(match);
    return `__PHRASE_${phrases.length - 1}__`;
  });

  // Step 2: strip unmatched specials
  text = text.replace(/[[\]{}()"^]/g, " ");

  // Step 3: collapse repeated asterisks
  text = text.replace(/\*+/g, "*");

  // Step 4: strip dangling boolean operators
  text = text.replace(/^\s*(AND|OR|NOT)\s+/i, "");
  text = text.replace(/\s+(AND|OR|NOT)\s*$/i, "");

  // Step 5: auto-quote dotted/hyphenated/underscored identifiers
  text = text.replace(/\b\w+[-._]\w[\w\-._]*\b/g, (match) => `"${match}"`);

  // Step 6: restore preserved phrases
  for (let i = 0; i < phrases.length; i += 1) {
    text = text.replace(`__PHRASE_${i}__`, phrases[i] ?? "");
  }

  // Edge: if everything got stripped, return empty (caller handles)
  return text.trim();
}
```

## CJK routing (orthogonal)

CJK chars (Chinese, Japanese, Korean) bypass o sanitizer normal e vão
para uma FTS5 table com `tokenize='trigram'` (overlapping 3-byte
sequences). Detecção:

```typescript
const CJK_RANGES = [
  [0x3000, 0x303f], // CJK Symbols
  [0x3040, 0x309f], // Hiragana
  [0x30a0, 0x30ff], // Katakana
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xac00, 0xd7af], // Hangul
];

export function containsCjk(text: string): boolean {
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    for (const [lo, hi] of CJK_RANGES) {
      if (cp >= lo && cp <= hi) return true;
    }
  }
  return false;
}
```

Routing: query → contém CJK? → trigram table OR LIKE fallback (se <3 CJK chars). Não-CJK → default tokenizer + sanitizer.

## Failure modes prevenidos

1. **Hyphenated identifier search returning nothing**: `auth-token` vira
   `auth AND token`, retorna só messages que tenham AMBOS, perde matches
   que tinham `auth-token` exato.
   Com step 5: `"auth-token"` phrase match.

2. **Syntax error em runtime**: `^special` chars no input quebram
   `WHERE MATCH ?`. Exception 500ms depois do user clicar search.
   Com step 2: chars limpos antes do SQL.

3. **`DROP TABLE` em query — não SQL injection** (FTS5 não permite), mas
   o user digitou: `"DROP TABLE"` em phrase = match de "DROP" near "TABLE".
   Com step 1: phrase preservada. Search semântica intacta.

4. **Prefix query duplicada**: `auth***` parseia errado. Com step 3:
   collapse para `auth*` válido.

## Failure modes NÃO prevenidos

- **Search vazia depois do sanitize**: se input era só `"^^^^"`, ficou
  string vazia. Caller precisa checkar e retornar resultado vazio
  graciosamente, não chamar FTS5 com `""`.

- **CJK + Latin misturado**: `error_code エラー` requer routing complexo.
  Hermes route por "se TEM CJK ≥3 chars → trigram, senão → default".
  Mixed-script queries podem perder hits no Latin side.

- **Trigram para Latin com < 3 chars**: `ab` no trigram não match nada
  (precisa 3 chars). Fallback para LIKE `'%ab%'` — slow mas correct.

## Como testar

```typescript
it("preserves quoted phrases", () => {
  expect(sanitizeFts5Query('"hello world" foo'))
    .toBe('"hello world" foo');
});

it("auto-quotes hyphenated identifier", () => {
  expect(sanitizeFts5Query("error-code"))
    .toBe('"error-code"');
});

it("auto-quotes dotted version", () => {
  expect(sanitizeFts5Query("v2.3.1"))
    .toBe('"v2.3.1"');
});

it("auto-quotes underscored identifier", () => {
  expect(sanitizeFts5Query("auth_token"))
    .toBe('"auth_token"');
});

it("collapses repeated asterisks", () => {
  expect(sanitizeFts5Query("auth***"))
    .toBe("auth*");
});

it("strips dangling AND", () => {
  expect(sanitizeFts5Query("AND foo"))
    .toBe("foo");
  expect(sanitizeFts5Query("foo AND"))
    .toBe("foo");
});

it("strips unmatched specials", () => {
  expect(sanitizeFts5Query("foo(bar"))
    .toMatch(/^foo\s+bar$/);
});

it("routes CJK to trigram path", () => {
  expect(containsCjk("大别山")).toBe(true);
  expect(containsCjk("hello")).toBe(false);
  expect(containsCjk("éxito")).toBe(false); // not CJK
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/session-db/`:

- `sanitize-fts5.ts` — `sanitizeFts5Query`, `containsCjk`
- `search.ts` — chama sanitize, route CJK
- `schema.ts` — cria `messages_fts` + `messages_fts_trigram` em paralelo

## Referências cruzadas

- [sqlite-wal-fallback.md](./sqlite-wal-fallback.md) — conexão setup antes da search
- [schema-versioning.md](./schema-versioning.md) — bumps quando adiciona index novo
- [testing-invariant-vs-snapshot.md](./testing-invariant-vs-snapshot.md) — test invariants das 6 steps, não regex específicos

## Citações primárias

- `referencia/hermes-agent/hermes_state.py:1797-1847` — 6-step sanitizer Python canonical
- `referencia/hermes-agent/hermes_state.py:253-306` — schema FTS5 tables
- `referencia/hermes-agent/hermes_state.py:1851-1858` — CJK ranges
- `.claude/knowledge-base/hermes-deep-dive/04-cross-session-fts5.md:159-200` — AD-1, AD-2
- 10 PRs históricos (listados no doc 00)
