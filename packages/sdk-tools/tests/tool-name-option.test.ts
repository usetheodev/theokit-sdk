/**
 * M76 T1.2 — name and description become factory options.
 *
 * ## Why in the factory, and not only in the decorator
 *
 * In Codex — this project's single reference — the name is born in the tool definition
 * (`core/src/tools/handlers/agent_jobs_spec.rs:63`: `ToolSpec::Function(ResponsesApiTool { name: … })`)
 * and is consumed as the **approval decision key** (`core/src/tools/approvals.rs:319`:
 * `flat_tool_name(&tool_ctx.tool_name)`), besides being what the model sees and what telemetry records.
 *
 * Three consumers of a string decided in one place. Treating it as a post-hoc decorator produced, in the
 * agent-builder, four renames stacked at the composition point — `registry.ts:97,104,107` and
 * `subagents/analyst.ts:28` — and a name that only exists after the tool has been built.
 *
 * ## O que estes testes protegem
 *
 * The change is **additive**, and the test that matters most is the DEFAULT one: omitting the option must produce
 * exatamente o literal de hoje. Se o default escorregasse, o modelo veria outra tool e — pior — os
 * approvals gravados por nome deixariam de casar, silenciosamente.
 *
 * `withName`/`withDescription` still exist for the dynamic case; the last test guarantees they
 * do not regress.
 */
import { describe, expect, it } from "vitest";
import { createEditFileTool } from "../src/edit-file.js";
import { withName } from "../src/internal/tool-aci.js";
import { createListDirTool } from "../src/list-dir.js";
import { createSearchTextTool } from "../src/search-text.js";
import { createShellTool } from "../src/shell-exec.js";

const raiz = "/tmp";

describe("M76 T1.2 — name/description as a factory option", () => {
  it("test_name_da_fabrica_vence_o_default", () => {
    const t = createSearchTextTool({ projectRoot: raiz, name: "grep" });
    expect(t.name).toBe("grep");
  });

  it("test_description_da_fabrica_vence_o_default", () => {
    const t = createSearchTextTool({ projectRoot: raiz, description: "Busca literal ou regex." });
    expect(t.description).toBe("Busca literal ou regex.");
  });

  it("test_sem_name_o_default_e_preservado", () => {
    // O teste mais importante: retrocompatibilidade. Um default que escorrega muda a tool que o
    // the model sees and breaks approvals recorded by name — with no error, no log.
    expect(createSearchTextTool({ projectRoot: raiz }).name).toBe("search_text");
    expect(createListDirTool({ projectRoot: raiz }).name).toBe("list_dir");
  });

  it("test_sem_description_o_default_e_preservado", () => {
    // M76 review (M2) — the two earlier assertions (`length > 0` and `not.toBe("")`) said the SAME
    // thing two ways, and neither tested what the name promises: that the default is
    // PRESERVED. Replacing the description with "x" satisfied both. The default's oracle is the
    // default itself — the description the model reads must contain what the tool does.
    const t = createSearchTextTool({ projectRoot: raiz });
    expect(t.description).toMatch(/search|busca|grep|text/i);
    // And it must not be affected by passing `name`: the two options are independent.
    expect(createSearchTextTool({ projectRoot: raiz, name: "grep" }).description).toBe(
      t.description,
    );
  });

  it("test_M1_name_e_description_valem_para_edit_file_e_shell_exec", () => {
    // M76 review (M1) — the DoD said "all *ToolOptions", and the test covered only `search_text` and
    // `list_dir`. `edit_file` and `shell_exec` are precisely the two tools whose name is an
    // APPROVAL key: renaming one of them with nothing checking is the shortest path to a recorded
    // approval silently ceasing to match.
    const edit = createEditFileTool({ projectRoot: raiz, name: "aplicar_patch" });
    expect(edit.name).toBe("aplicar_patch");
    expect(createEditFileTool({ projectRoot: raiz }).name).toBe("edit_file");

    const sh = createShellTool({ projectRoot: raiz, name: "rodar" });
    expect(sh.name).toBe("rodar");
    expect(createShellTool({ projectRoot: raiz }).name).toBe("shell_exec");
  });

  it("test_with_name_continua_funcionando", () => {
    // The dynamic path does not regress: renaming AFTERWARDS remains possible for callers deciding the
    // name outside construction.
    const t = withName(createSearchTextTool({ projectRoot: raiz }), "grep");
    expect(t.name).toBe("grep");
  });

  it("test_a_opcao_e_o_decorator_concordam", () => {
    // ANCHOR: both paths produce the SAME name. If they diverged, we would have two sources of
    // verdade para a chave de approval — exatamente o defeito que este milestone existe para fechar.
    const viaOpcao = createSearchTextTool({ projectRoot: raiz, name: "grep" });
    const viaDecorator = withName(createSearchTextTool({ projectRoot: raiz }), "grep");
    expect(viaOpcao.name).toBe(viaDecorator.name);
  });
});
