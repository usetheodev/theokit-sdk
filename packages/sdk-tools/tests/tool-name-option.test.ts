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
 * ## What these tests protect
 *
 * The change is **additive**, and the test that matters most is the DEFAULT one: omitting the option must produce
 * exactly today's literal. If the default slipped, the model would see a different tool and — worse — the
 * approvals recorded by name would stop matching, silently.
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

const root = "/tmp";

describe("M76 T1.2 — name/description as a factory option", () => {
  it("test_the_factory_name_beats_the_default", () => {
    const t = createSearchTextTool({ projectRoot: root, name: "grep" });
    expect(t.name).toBe("grep");
  });

  it("test_the_factory_description_beats_the_default", () => {
    const t = createSearchTextTool({ projectRoot: root, description: "Literal or regex search." });
    expect(t.description).toBe("Literal or regex search.");
  });

  it("test_without_a_name_the_default_is_preserved", () => {
    // The most important test: backward compatibility. A default that slips changes the tool the
    // the model sees and breaks approvals recorded by name — with no error, no log.
    expect(createSearchTextTool({ projectRoot: root }).name).toBe("search_text");
    expect(createListDirTool({ projectRoot: root }).name).toBe("list_dir");
  });

  it("test_without_a_description_the_default_is_preserved", () => {
    // M76 review (M2) — the two earlier assertions (`length > 0` and `not.toBe("")`) said the SAME
    // thing two ways, and neither tested what the name promises: that the default is
    // PRESERVED. Replacing the description with "x" satisfied both. The default's oracle is the
    // default itself — the description the model reads must contain what the tool does.
    const t = createSearchTextTool({ projectRoot: root });
    expect(t.description).toMatch(/search|grep|text|find/i);
    // And it must not be affected by passing `name`: the two options are independent.
    expect(createSearchTextTool({ projectRoot: root, name: "grep" }).description).toBe(
      t.description,
    );
  });

  it("test_M1_name_and_description_apply_to_edit_file_and_shell_exec", () => {
    // M76 review (M1) — the DoD said "all *ToolOptions", and the test covered only `search_text` and
    // `list_dir`. `edit_file` and `shell_exec` are precisely the two tools whose name is an
    // APPROVAL key: renaming one of them with nothing checking is the shortest path to a recorded
    // approval silently ceasing to match.
    const edit = createEditFileTool({ projectRoot: root, name: "apply_patch" });
    expect(edit.name).toBe("apply_patch");
    expect(createEditFileTool({ projectRoot: root }).name).toBe("edit_file");

    const sh = createShellTool({ projectRoot: root, name: "run" });
    expect(sh.name).toBe("run");
    expect(createShellTool({ projectRoot: root }).name).toBe("shell_exec");
  });

  it("test_with_name_keeps_working", () => {
    // The dynamic path does not regress: renaming AFTERWARDS remains possible for callers deciding the
    // name outside construction.
    const t = withName(createSearchTextTool({ projectRoot: root }), "grep");
    expect(t.name).toBe("grep");
  });

  it("test_the_option_and_the_decorator_agree", () => {
    // ANCHOR: both paths produce the SAME name. If they diverged, we would have two sources of
    // true for the approval key — exactly the defect this milestone exists to close.
    const viaOption = createSearchTextTool({ projectRoot: root, name: "grep" });
    const viaDecorator = withName(createSearchTextTool({ projectRoot: root }), "grep");
    expect(viaOption.name).toBe(viaDecorator.name);
  });
});
