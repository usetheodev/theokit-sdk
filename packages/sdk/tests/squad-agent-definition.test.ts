/**
 * M81 T2.2 — `Squad.create` accepts an `AgentDefinition`, not only an already-built `SDKAgent`.
 *
 * ## O que mudou de fato
 *
 * `squad.ts` declarava `agents: ReadonlyArray<SDKAgent>`. Montar um time obrigava o chamador a
 * **materialize each agent by hand** first — resolve the credential, build options, call
 * `Agent.create`, await. That is exactly the work this milestone moves into the framework in its
 * other tasks; leaving it here would be inconsistent.
 *
 * With `discoverSubagents` public (T2.1), the data describing an agent became reachable by the
 * consumidor. Aceitar esse dado direto fecha o circuito: descobrir → montar time, sem etapa manual
 * no meio.
 *
 * ## The half that matters most is backward compatibility
 *
 * A built `SDKAgent` is still accepted, and so is mixing the two in one list — a real team
 * usually has agents from different origins. A test proving only the new path would pass
 * mesmo se o antigo tivesse quebrado.
 */
import { describe, expect, it } from "vitest";

import { Squad } from "../src/squad.js";
import type { AgentDefinition, SDKAgent } from "../src/types/agent.js";

const definition: AgentDefinition = {
  description: "explores the repository",
  prompt: "You explore.",
};

/** Minimal `SDKAgent` double — the Squad only needs it to exist in order to compose the workflow. */
const agenteConstruido = { agentId: "ja-construido" } as unknown as SDKAgent;

describe("M81 T2.2 — Squad.create aceita AgentDefinition", () => {
  it("test_Squad_aceita_AgentDefinition_como_membro", () => {
    // O caminho novo: dado puro entra, o Squad materializa quando for rodar.
    const squad = Squad.create({ agents: [definition] });
    expect(squad).toBeDefined();
    expect(squad.run).toBeTypeOf("function");
  });

  it("test_CONTRAPROVA_SDKAgent_ja_construido_continua_aceito", () => {
    // Sem esta, trocar o tipo por `AgentDefinition` puro passaria no teste acima e quebraria todo
    // an existing consumer silently — the Squad does not run at construction, so the break would only
    // apareceria no primeiro `run()`.
    const squad = Squad.create({ agents: [agenteConstruido] });
    expect(squad).toBeDefined();
  });

  it("test_aceita_MISTURA_dos_dois_na_mesma_lista", () => {
    // The real case: a team with one agent from disk and another built by the app.
    const squad = Squad.create({ agents: [definition, agenteConstruido] });
    expect(squad).toBeDefined();
  });

  it("test_a_materializacao_ACONTECE_de_fato_ao_rodar", async () => {
    // The missing test, and the gap was found by mutation: swapping the type guard for
    // `() => true` (treating EVERY member as already built) killed no test, because the
    // others only prove the TYPE accepts — never that materialization runs.
    //
    // The assertion is POSITIVE on purpose. The first version said
    // `.not.toContain("send is not a function")` — a negative the mutation did not move, because the
    // run fails earlier for another reason and the negative was vacuously true.
    //
    // `definition` declares no model, so a SUCCESSFUL materialization reaches `Agent.create`
    // and fails there with "requires a model selection". That specific message is only reachable if
    // someone turned the data into an agent — it is the proof that materialization ran.
    const squad = Squad.create({ agents: [definition] });
    const err = await squad.run("oi").catch((e: unknown) => e);

    expect(
      String(err instanceof Error ? err.message : err),
      "did not reach `Agent.create` — the AgentDefinition was treated as an already-built agent",
    ).toContain("model selection");
  });

  it("test_lista_vazia_continua_sendo_erro_TIPADO", () => {
    // The existing validation must not regress when the type gains the union.
    expect(() => Squad.create({ agents: [] })).toThrow();
  });
});
