/**
 * M96 U3 (Phase 1, T1.1/T1.2) — `settingSources` stops being a literal `true` on the public port.
 *
 * ## O defeito que estes testes fecham
 *
 * `subagents-loader.ts:29-31` chamava `loadSubagents(cwd, true, undefined)`. O loader interno
 * (`internal/runtime/skills/subagents-loader.ts:19`) has ALWAYS accepted the
 * `settingSourcesIncludeProject` parameter — it was the public port that hid it behind a literal, against
 * the SDK's own `settingSources` docstring. Publishing the parameter is U3.
 *
 * ## Why a closed union and not a boolean (ADR D7 of plan m96)
 *
 * A positional `boolean` cannot admit a third source without breaking, and is unreadable at the call
 * site. The peer that solved the same problem used a named parameter
 * (`gemini-cli/agentLoader.ts:637-642`). O default `['project']` reproduz byte a byte o
 * comportamento do `true` de hoje.
 *
 * ## The negative case's oracle (ADR D4)
 *
 * `settingSources: []` must return `{}` **and** not have read the directory. A test looking only at
 * the empty return would pass on an implementation that reads everything and filters afterwards — and that
 * implementation would fail M97's security purpose, which gates the READ of the project source.
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

const agentsDir = join(cwd, ".theokit", "agents");
mkdirSync(agentsDir, { recursive: true });
writeFileSync(
  join(agentsDir, "analyst.md"),
  "---\nname: analyst\ndescription: analyzes\n---\n\nYou analyze.\n",
);

function leiturasDoDiretorioDeAgentes(): unknown[] {
  return readdirEspiao.mock.calls.filter(
    ([p]) => typeof p === "string" && p.includes(join(".theokit", "agents")),
  );
}

describe("M96 U3 — settingSources on the loader public port", () => {
  it("test_discoverSubagents_sem_opcoes_continua_lendo_a_fonte_de_projeto", async () => {
    // A contraprova do default: sem ela, trocar o default para `[]` passaria em todos os
    // new tests and would silently erase the project-subagent route.
    const found = await discoverSubagents(cwd);
    expect(Object.keys(found)).toContain("analyst");
  });

  it("test_settingSources_project_e_equivalente_ao_default", async () => {
    const comDefault = await discoverSubagents(cwd);
    const explicito = await discoverSubagents(cwd, { settingSources: ["project"] });
    expect(explicito).toEqual(comDefault);
  });

  it("test_NEGATIVE_an_empty_settingSources_returns_an_empty_object_AND_DOES_NOT_READ_THE_DIRECTORY", async () => {
    readdirEspiao.mockClear();

    const found = await discoverSubagents(cwd, { settingSources: [] });

    expect(found, "with no declared source there is no subagent to return").toEqual({});
    expect(
      leiturasDoDiretorioDeAgentes(),
      "the absent side effect (D4): the directory must not have been read",
    ).toHaveLength(0);
  });

  it("test_NEGATIVE_an_unknown_source_is_a_typed_error", async () => {
    // error-handling.md § 2: a typed error naming the received value and the accepted sources, never a
    // neither a silent `undefined` nor a filter that discards the invalid source without warning.
    const fonteInvalida = ["global"] as unknown as readonly "project"[];

    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      ConfigurationError,
    );
    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      /global.*project/s,
    );
  });

  it("test_NEGATIVE_an_unknown_source_DOES_NOT_READ_THE_DIRECTORY", async () => {
    // The effect half of the negative case above: refusing AFTER reading would already have read.
    readdirEspiao.mockClear();
    const fonteInvalida = ["global"] as unknown as readonly "project"[];

    await expect(discoverSubagents(cwd, { settingSources: fonteInvalida })).rejects.toThrow(
      ConfigurationError,
    );
    expect(leiturasDoDiretorioDeAgentes()).toHaveLength(0);
  });

  it("test_loadSubagentDefinition_repassa_as_opcoes", async () => {
    // The module's second public port must not go without the parameter; without this assertion
    // U3 would close half the surface.
    expect(await loadSubagentDefinition("analyst", cwd)).toBeDefined();
    expect(await loadSubagentDefinition("analyst", cwd, { settingSources: [] })).toBeUndefined();
  });

  it("test_the_published_arity_is_2_because_the_signature_has_NO_initializer", async () => {
    // EC-6: `function f(cwd, options)` returns 2; `function f(cwd, options = {})` returns 1. The two
    // shapes implement D7, and only one satisfies the criteria anchored on arity (T2.1, T7.1).
    // The PRIMARY oracle of those criteria is the effect one (`{ settingSources: [] }` -> `{}`), measured
    // above; this is the secondary assertion pinning the shape where it is decided.
    expect(discoverSubagents.length).toBe(2);
  });

  it("test_the_definition_type_is_reachable_via_the_loader_subpath", async () => {
    // D6: a camada `@theokit/agents` vai aliasar este tipo como `SubagentDefinition`, e o alias
    // needs a symbol to resolve from. `tsconfig.json` includes `tests/**/*`, so
    // `pnpm typecheck` is what executes this assertion — the runtime value only anchors it.
    const found: Record<string, AgentDefinition> = await discoverSubagents(cwd);
    const analyst: AgentDefinition | undefined = found.analyst;
    expect(analyst?.description).toBe("analyzes");
  });
});
