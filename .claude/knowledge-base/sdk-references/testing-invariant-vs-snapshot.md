# Testing: Invariant vs Snapshot

> **Tests devem assertar invariants, não snapshots.** Change-detector
> tests (que verificam exact data atual) quebram em CADA routine update
> sem adicionar coverage. Hermes proíbe explicitly em code review
> (AGENTS.md:1033-1077). Esse é o filter mental para "este teste merece
> existir?"

## A regra

| Tipo de teste | Quando deletar | Quando manter |
|---|---|---|
| **Snapshot** ("X tem value Y") | Sempre — não adiciona coverage | Nunca |
| **Invariant** ("X has shape Z, relationship Y") | Quando shape muda | Sempre while shape estável |
| **Behavior** ("input I → output O por business rule R") | Quando R muda | Sempre while R holds |

## Exemplos: snapshot ❌ vs invariant ✅

### Provider catalog

```typescript
// ❌ SNAPSHOT — quebra em cada provider release
it("Gemini catalog has gemini-2.5-pro", () => {
  expect(PROVIDER_MODELS.gemini).toContain("gemini-2.5-pro");
});

// ✅ INVARIANT — protege shape, não exact data
it("Gemini provider is registered", () => {
  expect(PROVIDER_MODELS).toHaveProperty("gemini");
});

it("Each provider has at least 1 tool-calling-capable model", () => {
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    expect(models.length).toBeGreaterThanOrEqual(1);
  }
});
```

### Config schema

```typescript
// ❌ SNAPSHOT
it("config version is 11", () => {
  expect(CONFIG_VERSION).toBe(11);
});

// ✅ INVARIANT
it("config version is positive integer", () => {
  expect(Number.isInteger(CONFIG_VERSION)).toBe(true);
  expect(CONFIG_VERSION).toBeGreaterThan(0);
});

it("config schema has all required sections", () => {
  const required = ["security", "telemetry", "memory"];
  for (const section of required) {
    expect(DEFAULT_CONFIG).toHaveProperty(section);
  }
});
```

### Tool registry

```typescript
// ❌ SNAPSHOT
it("has exactly 98 tools", () => {
  expect(registry.list()).toHaveLength(98);
});

// ✅ INVARIANT
it("registry rejects duplicates", () => {
  expect(() => registry.register(existingTool)).toThrow(/already registered/);
});

it("each tool has required fields", () => {
  for (const tool of registry.list()) {
    expect(tool.name).toBeTruthy();
    expect(tool.inputSchema).toBeDefined();
    expect(typeof tool.handler).toBe("function");
  }
});
```

### Error messages

```typescript
// ❌ SNAPSHOT — quebra se reword a mensagem
it("error says 'Provider must be specified'", () => {
  expect(() => Agent.create({})).toThrow("Provider must be specified");
});

// ✅ INVARIANT
it("throws ConfigurationError when provider missing", () => {
  expect(() => Agent.create({})).toThrow(ConfigurationError);
});

it("error code is configurable_provider_missing", () => {
  try {
    Agent.create({});
  } catch (e) {
    expect((e as ConfigurationError).code).toBe("provider_missing");
  }
});
```

## A heurística — leia o test, pergunte

> "Esse test reads like a SNAPSHOT of current data, ou like a CONTRACT
> sobre how two pieces of data must relate?"

**Snapshot** → delete:
- "Tem value X"
- "Has exact length N"
- "Equals exact string"
- "Contains specific item"

**Contract** → keep:
- "Has shape X"
- "Length is ≥ 1"
- "Matches schema X"
- "Relates A to B via R"

## Por que snapshots são tóxicos

3 razões:

1. **Quebram em cada release sem adicionar value**. Update provider list
   → 50 snapshot tests fall. Engineer fixes them mecanicamente, não há
   coverage diference, só ruído.

2. **Mascaram bugs reais**. Snapshot teste passa porque tudo "exactly
   matches snapshot", mas snapshot está documentando bug. Refactor
   moves the data, but tests still pass because snapshot moved with it.

3. **Sinalizam wrong test framing**. Se você está testando "value tem
   este valor exato", você não está testando comportamento — está
   testando configuração. Configuração não precisa de teste; precisa de
   validation.

## Quando snapshot SE justifica

Few cases. Documente sempre:

- **API response shape vs known fixture**: gravar response do provider
  uma vez, dif contra futuras runs. Detecta provider API drift. Aceita
  manual update quando drift é intencional.

- **Visual regression** (não aplicável a SDK): pixel diff.

- **Compiled output** (CSS-in-JS, codegen): byte-equal a fixture
  fica em snapshot file (`__snapshots__/`). Updateable via `pnpm test -u`.

Para SDK Theokit: snapshots têm uso ZERO na maioria dos cases. Default
é invariant.

## Tooling

### Vitest's `toMatchSnapshot()` é o anti-pattern

```typescript
// Tentação fácil
it("formats this object", () => {
  expect(formatTask(task)).toMatchSnapshot();
});

// Resultado:
// __snapshots__/foo.test.ts.snap created
// "format" changes → snapshot diff appears
// Engineer runs `pnpm test -u` to "fix"
// Nothing was actually verified
```

Bata-da-mão: prefere `toEqual` com expected exact shape, ou `toMatchObject`
com partial shape:

```typescript
// Better
it("format includes required fields", () => {
  expect(formatTask(task)).toMatchObject({
    id: expect.stringMatching(/^t_/),
    status: expect.any(String),
  });
});
```

### Lint para flag snapshot usage

```json
// .eslintrc — warn on toMatchSnapshot
{
  "rules": {
    "no-restricted-syntax": [
      "warn",
      {
        "selector": "CallExpression[callee.property.name='toMatchSnapshot']",
        "message": "Prefer invariant assertions over snapshots. See sdk-references/testing-invariant-vs-snapshot.md"
      }
    ]
  }
}
```

## Code review checklist

Quando reviewing tests, pergunte:

- [ ] Esse test ainda passa se eu **adicionar** uma nova entry na lista?
- [ ] Esse test ainda passa se eu **renomear** uma string (mantendo semântica)?
- [ ] Esse test ainda passa se eu **mudar a ordem** dos elementos?
- [ ] Esse test ainda passa se eu **bump da version**?

Se YES a TODAS → invariant test. ✅

Se NO a alguma → likely snapshot. Re-shape para invariant ou delete.

## Failure modes prevenidos

1. **CI burden**: cada release exige fix de 50+ snapshot tests. Custa
   ~30min por release. Pattern invariant: 0 fixes for trivial updates.

2. **False security**: 17k tests verde, mas tudo são snapshots. Refactor
   passes silently — testes confirmam current state, não correctness.

3. **Test ownership rot**: ninguém entende por que esse test exists.
   Hesitam em deletar. Cruft acumula. Invariant tests têm clear purpose.

## Failure modes NÃO prevenidos

- **Tests com bug** (testando errado): invariant tests podem estar
  testando wrong invariant. Defesa: code review do test logic.

- **Coverage gaps**: focusing em invariants pode missear cases edge.
  Defesa: pirâmide de testes (unit + integration + e2e), property
  tests para state machines.

## Como ensinar isso

Code review feedback template:

> "Este teste reads como snapshot — checa que `X tem value Y`. Considere
> refrasear como invariant: o que faz X *correto*? Por exemplo, em vez
> de `expect(catalog.length).toBe(98)`, considere
> `expect(catalog.length).toBeGreaterThanOrEqual(1)`."

Link este doc.

## Citações primárias

- `referencia/hermes-agent/AGENTS.md:1033-1077` — "Do not write" / "Do write" examples
- `.claude/knowledge-base/hermes-deep-dive/00-orientation.md:281-289` — Translation rule
- `.claude/knowledge-base/hermes-deep-dive/14-testing-strategy.md:119+` — AD-6 (full ban rationale)

## Cross-references

- [hermetic-test-isolation.md](./hermetic-test-isolation.md) — fixture pattern
- [property-based-testing.md](./property-based-testing.md) — invariants em scale via fast-check
