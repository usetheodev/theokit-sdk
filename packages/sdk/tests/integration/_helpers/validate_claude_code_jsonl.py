#!/usr/bin/env python3
"""SE39 acceptance helper — validate a .jsonl against the REAL claude-code-log parser.

Usage: validate_claude_code_jsonl.py <clone_dir> <jsonl_path>
Exits 0 and prints "OK <n> records, <p> tool pairs" when every line parses via
`create_transcript_entry` (the parser's Pydantic-backed dict->model boundary) AND every tool_use has
a matching tool_result (zero dangling). Exits 1 with the failure on any error.
"""
import json
import sys

clone, path = sys.argv[1], sys.argv[2]
sys.path.insert(0, clone)
try:
    from claude_code_log.factories.transcript_factory import create_transcript_entry
except Exception as e:  # noqa: BLE001 — surface an import/availability failure to the caller
    print(f"UNAVAILABLE: {e}")
    sys.exit(2)

use_ids, result_refs, n, i = set(), set(), 0, -1
try:
    for i, line in enumerate(open(path, encoding="utf-8")):
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        create_transcript_entry(data)  # raises on schema violation
        n += 1
        for b in data.get("message", {}).get("content", []) or []:
            if isinstance(b, dict):
                if b.get("type") == "tool_use":
                    use_ids.add(b.get("id"))
                elif b.get("type") == "tool_result":
                    result_refs.add(b.get("tool_use_id"))
except Exception as e:  # noqa: BLE001
    print(f"PARSE_FAIL line {i}: {type(e).__name__}: {e}")
    sys.exit(1)

dangling = use_ids - result_refs
if dangling:
    print(f"DANGLING tool_use with no result: {sorted(dangling)}")
    sys.exit(1)
orphan = result_refs - use_ids
if orphan:
    print(f"ORPHAN tool_result with no matching tool_use: {sorted(orphan)}")
    sys.exit(1)
print(f"OK {n} records, {len(use_ids)} tool pairs")
sys.exit(0)
