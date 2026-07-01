/**
 * theokit#58 follow-up — leaked-dialect safe-parse.
 *
 * Some models (qwen3-coder via OpenRouter) emit their Hermes tool-call dialect as assistant TEXT
 * instead of native `tool_calls`. With ZERO native tool_calls the loop drops the intended call.
 * The OPT-IN extractor recovers those calls from content so the loop executes them. Tests cover the
 * pure helper + the accumulator integration (flag off = bug state preserved; flag on = recovery;
 * native tool_calls = no double-count).
 */
import { describe, expect, it } from "vitest";
import { extractHermesToolCalls } from "../../../src/internal/llm/hermes-tool-extract.js";
import { __testing__OpenAIStreamAccumulator } from "../../../src/internal/llm/openai.js";

const LEAK = "<function=shell_exec><parameter=command>echo hi</parameter></function></tool_call>";

describe("extractHermesToolCalls (pure helper)", () => {
  it("test_extracts_single_block_with_param", () => {
    let n = 0;
    const r = extractHermesToolCalls(LEAK, () => `id-${++n}`);
    expect(r.toolCalls).toEqual([
      { type: "tool_use", id: "id-1", name: "shell_exec", input: { command: "echo hi" } },
    ]);
    expect(r.residualText).toBe("");
  });

  it("test_extracts_multiple_params", () => {
    const block =
      "<function=write_file><parameter=path>/tmp/x</parameter><parameter=content>hello</parameter></function></tool_call>";
    const r = extractHermesToolCalls(block, () => "id");
    expect(r.toolCalls[0]?.input).toEqual({ path: "/tmp/x", content: "hello" });
  });

  it("test_trims_leading_trailing_whitespace_from_param_value (leaked-newline root cause)", () => {
    // qwen3-coder leaks the dialect with the value on its own line, so the param VALUE carries
    // leading/trailing formatting newlines: `<parameter=path>\npackage.json\n</parameter>`. Untrimmed,
    // read_file / glob_files / search_text receive path:"\npackage.json\n" -> not_found (only
    // shell_exec tolerates it, since bash ignores blank lines), so a multi-read investigation loops
    // on not_found and never converges (the "hang"). Trim the value at the extraction boundary.
    // Mirrors the agentfw reference `parseInvokeParameters` (`(m[2] ?? '').trim()`, xml-tool-calls.ts:179).
    const block =
      "<function=read_file><parameter=path>\npackage.json\n</parameter></function></tool_call>";
    const r = extractHermesToolCalls(block, () => "id");
    expect(r.toolCalls[0]?.input).toEqual({ path: "package.json" });
  });

  it("test_preserves_internal_newlines_of_multiline_param_value", () => {
    // The trim removes only the leading/trailing whitespace — a legitimate multi-line command keeps
    // its internal newlines intact (edge case: a valid extreme, not a malformed input).
    const block =
      "<function=shell_exec><parameter=command>\nline1\nline2\n</parameter></function></tool_call>";
    const r = extractHermesToolCalls(block, () => "id");
    expect(r.toolCalls[0]?.input).toEqual({ command: "line1\nline2" });
  });

  it("test_parseHermesParams_still_trims_key (EC-7)", () => {
    // T3.1 DRY: value-trim delegates to sanitizeToolInput; the KEY stays clean (whitespace around
    // the key never reaches the input map). Guards against the delegation dropping key hygiene.
    const block =
      "<function=read_file><parameter= path >\npackage.json\n</parameter></function></tool_call>";
    const r = extractHermesToolCalls(block, () => "id");
    expect(r.toolCalls[0]?.input).toEqual({ path: "package.json" });
  });

  it("test_extracts_multiple_blocks", () => {
    let n = 0;
    const r = extractHermesToolCalls(`${LEAK}${LEAK}`, () => `id-${++n}`);
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls.map((c) => c.name)).toEqual(["shell_exec", "shell_exec"]);
  });

  it("test_no_block_returns_original_text_no_calls", () => {
    const text = "just a normal answer with no dialect";
    const r = extractHermesToolCalls(text, () => "id");
    expect(r.toolCalls).toHaveLength(0);
    expect(r.residualText).toBe(text);
  });

  it("test_partial_block_fails_open_preserved_as_text", () => {
    // Missing the closing </tool_call> — fail-open: NOT matched, left as text, no fabricated call.
    const partial = "<function=shell_exec><parameter=command>echo hi</parameter></function>";
    const r = extractHermesToolCalls(partial, () => "id");
    expect(r.toolCalls).toHaveLength(0);
    expect(r.residualText).toBe(partial);
  });

  it("test_preserves_surrounding_prose_in_residual", () => {
    const r = extractHermesToolCalls(`I'll run it. ${LEAK} done.`, () => "id");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.residualText).toContain("I'll run it.");
    expect(r.residualText).toContain("done.");
    expect(r.residualText).not.toContain("<function=");
  });

  // R5 — request-scoped tool-name gate (blueprint request-scoped-matching, ADR D1).
  const WRITE = "<function=write><parameter=p>x</parameter></function></tool_call>";
  const READ = "<function=read><parameter=p>y</parameter></function></tool_call>";
  const EXAMPLE = "<function=example><parameter=p>z</parameter></function></tool_call>";

  it("test_gate_recovers_block_when_name_in_allowlist", () => {
    const r = extractHermesToolCalls(LEAK, () => "id", new Set(["shell_exec"]));
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("shell_exec");
  });

  it("test_gate_drops_block_when_name_not_in_allowlist", () => {
    const r = extractHermesToolCalls(WRITE, () => "id", new Set(["read"]));
    expect(r.toolCalls).toHaveLength(0);
    expect(r.residualText).toContain("<function=write");
  });

  it("test_gate_empty_allowlist_recovers_nothing", () => {
    const r = extractHermesToolCalls(LEAK, () => "id", new Set());
    expect(r.toolCalls).toHaveLength(0);
    expect(r.residualText).toContain("<function=shell_exec");
  });

  it("test_absent_allowlist_recovers_all_backcompat", () => {
    // 2-arg call (no allowlist) → recover-all, unchanged behavior.
    const r = extractHermesToolCalls(WRITE, () => "id");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("write");
  });

  it("test_gate_mixed_blocks_keeps_only_allowed", () => {
    let n = 0;
    const r = extractHermesToolCalls(`${WRITE}${READ}`, () => `id-${++n}`, new Set(["read"]));
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("read");
  });

  it("test_gate_residual_preserves_gated_out_block_text (EC-5)", () => {
    // One recovered (write) + one gated-out (example) in the same content: the gated-out block's
    // text MUST stay visible in residual, not be stripped by the blanket block-removal.
    let n = 0;
    const r = extractHermesToolCalls(
      `${WRITE} see ${EXAMPLE}`,
      () => `id-${++n}`,
      new Set(["write"]),
    );
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("write");
    expect(r.residualText).toContain("<function=example");
    // EC-5 full contract: the PROMOTED block is also stripped (not just the gated-out one preserved).
    expect(r.residualText).not.toContain("<function=write");
  });

  it("test_gate_uses_same_trimmed_name_for_match_and_call (EC-1)", () => {
    // Incidental whitespace around the leaked name: the gate must match the SAME trimmed name that
    // becomes the recovered call's name.
    const spaced = "<function= write ><parameter=p>x</parameter></function></tool_call>";
    const r = extractHermesToolCalls(spaced, () => "id", new Set(["write"]));
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("write");
  });

  it("test_gate_is_exact_not_substring_or_superstring", () => {
    // The gate is EXACT membership, NOT prefix/substring — a refactor to `.some(t => t.includes(name))`
    // would re-open the false-positive hole. `read` is a substring of the declared `read_file`.
    const READ_BLOCK = "<function=read><parameter=p>y</parameter></function></tool_call>";
    const dropShort = extractHermesToolCalls(READ_BLOCK, () => "id", new Set(["read_file"]));
    expect(dropShort.toolCalls).toHaveLength(0);
    expect(dropShort.residualText).toContain("<function=read");
    // And the superstring direction: leaked `read_file`, allowlist only `read`.
    const dropLong = extractHermesToolCalls(READ, () => "id", new Set(["rea"]));
    expect(dropLong.toolCalls).toHaveLength(0);
  });

  it("test_gate_case_mismatch_leaked_name_is_not_recovered", () => {
    // Exact match is CASE-SENSITIVE — a declared `Write` does not authorize a leaked `write`.
    const r = extractHermesToolCalls(WRITE, () => "id", new Set(["Write"]));
    expect(r.toolCalls).toHaveLength(0);
    expect(r.residualText).toContain("<function=write");
  });

  it("test_gate_reports_dropped_names_for_observability", () => {
    // A well-formed leaked block gated out by a defined allowlist is reported in droppedNames so the
    // caller can log the guard firing. Recover-all (undefined) reports nothing.
    const dropped = extractHermesToolCalls(WRITE, () => "id", new Set(["read"]));
    expect(dropped.droppedNames).toEqual(["write"]);
    const recoverAll = extractHermesToolCalls(WRITE, () => "id");
    expect(recoverAll.droppedNames).toEqual([]);
  });
});

function leakChunk(text: string) {
  return { choices: [{ index: 0, delta: { content: text } }] };
}
function stopChunk() {
  return { choices: [{ index: 0, finish_reason: "stop" }] };
}

describe("OpenAIStreamAccumulator — leaked-dialect safe-parse integration", () => {
  it("test_flag_off_leaves_leaked_dialect_as_text_no_tool_calls (bug state preserved)", () => {
    const acc = new __testing__OpenAIStreamAccumulator(false);
    acc.consume(leakChunk(LEAK));
    acc.consume(stopChunk());
    const finish = acc.finish();
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toContain("<function=");
  });

  it("test_flag_on_recovers_tool_call_and_flips_stop_reason", () => {
    const acc = new __testing__OpenAIStreamAccumulator(true);
    acc.consume(leakChunk(LEAK));
    acc.consume(stopChunk());
    const finish = acc.finish();
    expect(finish.toolCalls).toEqual([
      {
        type: "tool_use",
        id: expect.stringMatching(/^hermes-/),
        name: "shell_exec",
        input: { command: "echo hi" },
      },
    ]);
    expect(finish.stopReason).toBe("tool_use");
    expect(finish.text).not.toContain("<function=");
  });

  it("test_flag_on_with_native_tool_calls_does_not_double_extract", () => {
    const acc = new __testing__OpenAIStreamAccumulator(true);
    // Native tool_call delta present...
    acc.consume({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_native",
                function: { name: "real_tool", arguments: '{"a":1}' },
              },
            ],
          },
        },
      ],
    });
    // ...AND the content ALSO contains a leaked block (must be ignored — native wins).
    acc.consume(leakChunk(LEAK));
    acc.consume({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
    const finish = acc.finish();
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.toolCalls[0]?.name).toBe("real_tool");
    expect(finish.toolCalls[0]?.id).toBe("call_native");
  });

  it("test_flag_on_no_dialect_is_plain_text_no_calls", () => {
    const acc = new __testing__OpenAIStreamAccumulator(true);
    acc.consume(leakChunk("a normal answer"));
    acc.consume(stopChunk());
    const finish = acc.finish();
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toBe("a normal answer");
  });

  it("test_accumulator_request_scoped_gate_recovers_declared_tool (R5, T2.1 wiring)", () => {
    const acc = new __testing__OpenAIStreamAccumulator(true, "openai", new Set(["shell_exec"]));
    acc.consume(leakChunk(LEAK));
    acc.consume(stopChunk());
    const finish = acc.finish();
    expect(finish.toolCalls).toHaveLength(1);
    expect(finish.toolCalls[0]?.name).toBe("shell_exec");
    expect(finish.stopReason).toBe("tool_use");
  });

  it("test_accumulator_request_scoped_gate_drops_undeclared_tool (R5, T2.1 wiring)", () => {
    // The allowlist threaded through the constructor reaches finish() — an undeclared leaked name is
    // not promoted, proving the constructor→finish wiring (not just the pure gate).
    const acc = new __testing__OpenAIStreamAccumulator(true, "openai", new Set(["other_tool"]));
    acc.consume(leakChunk(LEAK));
    acc.consume(stopChunk());
    const finish = acc.finish();
    expect(finish.toolCalls).toHaveLength(0);
    expect(finish.stopReason).toBe("end_turn");
    expect(finish.text).toContain("<function=");
  });
});
