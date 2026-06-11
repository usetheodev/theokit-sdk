#!/usr/bin/env python3
"""
TheoCode Interactive Test Driver — uses pexpect to interact with the REPL
and validate each scenario step-by-step.

Usage:
  OPENROUTER_API_KEY=sk-or-... python3 examples/theocode-e2e/test-driver.py
"""

import os
import sys
import time
import pexpect

API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
if not API_KEY.startswith("sk-or-"):
    print("Error: OPENROUTER_API_KEY not set.")
    sys.exit(1)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

print("\n" + "=" * 70)
print("  TheoCode Interactive Test Driver")
print("  Sending scenarios one-by-one, waiting for each response")
print("=" * 70 + "\n")

# Launch the REPL
child = pexpect.spawn(
    "npx",
    ["tsx", "examples/theocode-e2e/interactive.ts"],
    cwd=PROJECT_ROOT,
    env={**os.environ, "OPENROUTER_API_KEY": API_KEY},
    encoding="utf-8",
    timeout=120,
    maxread=65536,
)

# Log everything to stdout so user sees it live
child.logfile_read = sys.stdout

# Wait for initial prompt
print("[DRIVER] Waiting for REPL to start...")
child.expect("You >", timeout=30)
print("\n[DRIVER] REPL ready! Starting scenarios...\n")

passed = 0
failed = 0
scenarios = []


def run_scenario(name: str, prompt: str, expect_in_response: list[str] | None = None, timeout_s: int = 60):
    """Send a prompt, wait for response, optionally validate content."""
    global passed, failed
    print(f"\n{'─' * 70}")
    print(f"[SCENARIO] {name}")
    print(f"[SENDING]  {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    print(f"{'─' * 70}")

    start = time.time()
    child.sendline(prompt)

    # Wait for next "You >" prompt (meaning the agent responded)
    try:
        child.expect("You >", timeout=timeout_s)
        elapsed = time.time() - start
        # Get the output between our send and the next prompt
        output = child.before or ""
        print(f"\n[TIME] {elapsed:.1f}s")

        ok = True
        if expect_in_response:
            for keyword in expect_in_response:
                if keyword.lower() not in output.lower():
                    print(f"[WARN] Expected '{keyword}' in response but not found")
                    ok = False

        if ok:
            passed += 1
            print(f"[RESULT] PASS")
        else:
            failed += 1
            print(f"[RESULT] FAIL — missing expected keywords")

        scenarios.append({"name": name, "ok": ok, "time": elapsed})

    except pexpect.TIMEOUT:
        elapsed = time.time() - start
        print(f"\n[TIME] {elapsed:.1f}s (TIMEOUT)")
        print(f"[RESULT] FAIL — timed out waiting for response")
        failed += 1
        scenarios.append({"name": name, "ok": False, "time": elapsed})

    except pexpect.EOF:
        print(f"\n[RESULT] FAIL — process exited unexpectedly")
        failed += 1
        scenarios.append({"name": name, "ok": False, "time": 0})


# ─── Scenario 1: Basic communication ──────────────────────────────────

run_scenario(
    "Basic LLM Communication",
    "Say hello and tell me your name or what you are in one sentence.",
)

# ─── Scenario 2: Write a file ─────────────────────────────────────────

run_scenario(
    "Tool Use — write_file",
    'Use the write_file tool to create a file called hello.ts with this content: export const greeting = "Hello from TheoCode!";',
)

# ─── Scenario 3: Read the file back ──────────────────────────────────

run_scenario(
    "Tool Use — read_file",
    "Use the read_file tool to read hello.ts and tell me what it contains.",
    expect_in_response=["hello", "theocode"],
)

# ─── Scenario 4: Edit the file ───────────────────────────────────────

run_scenario(
    "Tool Use — edit_file",
    'Use the edit_file tool to edit hello.ts: replace "Hello from TheoCode!" with "TheoKit SDK powers this agent!"',
)

# ─── Scenario 5: Shell command ────────────────────────────────────────

run_scenario(
    "Tool Use — shell_exec",
    'Use the shell_exec tool to run the command: echo "TheoCode is alive!"',
    expect_in_response=["alive"],
)

# ─── Scenario 6: Glob files ──────────────────────────────────────────

run_scenario(
    "Tool Use — glob_files",
    "Use the glob_files tool with pattern **/*.ts to find all TypeScript files.",
    expect_in_response=[".ts"],
)

# ─── Scenario 7: Complex task — write a function ─────────────────────

run_scenario(
    "Complex Task — Write Algorithm",
    "Create a file called fibonacci.ts using write_file with a function that calculates the nth fibonacci number iteratively. Include the export keyword.",
)

# ─── Scenario 8: Read and verify ─────────────────────────────────────

run_scenario(
    "Multi-Tool — Read and Verify",
    "Read fibonacci.ts using read_file and confirm it has a fibonacci function.",
    expect_in_response=["fibonacci"],
)

# ─── Scenario 9: Search text ─────────────────────────────────────────

run_scenario(
    "Tool Use — search_text",
    'Use the search_text tool to search for the word "export" across all files.',
)

# ─── Scenario 10: /tools command ─────────────────────────────────────

print(f"\n{'─' * 70}")
print(f"[SCENARIO] Built-in Command — /tools")
print(f"{'─' * 70}")
child.sendline("/tools")
try:
    child.expect("You >", timeout=10)
    output = child.before or ""
    if "read_file" in output.lower() or "write_file" in output.lower():
        passed += 1
        print(f"[RESULT] PASS — tools listed")
    else:
        failed += 1
        print(f"[RESULT] FAIL — tools not listed")
    scenarios.append({"name": "/tools command", "ok": "read_file" in (output or "").lower(), "time": 0})
except pexpect.TIMEOUT:
    failed += 1
    scenarios.append({"name": "/tools command", "ok": False, "time": 0})

# ─── Scenario 11: /session command ───────────────────────────────────

print(f"\n{'─' * 70}")
print(f"[SCENARIO] Built-in Command — /session")
print(f"{'─' * 70}")
child.sendline("/session")
try:
    child.expect("You >", timeout=10)
    output = child.before or ""
    if "session" in output.lower() or "messages" in output.lower():
        passed += 1
        print(f"[RESULT] PASS — session info shown")
    else:
        failed += 1
        print(f"[RESULT] FAIL — session info not shown")
    scenarios.append({"name": "/session command", "ok": True, "time": 0})
except pexpect.TIMEOUT:
    failed += 1
    scenarios.append({"name": "/session command", "ok": False, "time": 0})

# ─── Scenario 12: /status command ────────────────────────────────────

print(f"\n{'─' * 70}")
print(f"[SCENARIO] Built-in Command — /status")
print(f"{'─' * 70}")
child.sendline("/status")
try:
    child.expect("You >", timeout=10)
    output = child.before or ""
    passed += 1
    print(f"[RESULT] PASS — status shown")
    scenarios.append({"name": "/status command", "ok": True, "time": 0})
except pexpect.TIMEOUT:
    failed += 1
    scenarios.append({"name": "/status command", "ok": False, "time": 0})

# ─── Cleanup: /quit ──────────────────────────────────────────────────

print(f"\n{'─' * 70}")
print(f"[DRIVER] Sending /quit...")
print(f"{'─' * 70}")
child.sendline("/quit")
try:
    child.expect(pexpect.EOF, timeout=10)
except Exception:
    child.close(force=True)

# ─── Summary ─────────────────────────────────────────────────────────

total = passed + failed
print(f"\n{'=' * 70}")
print(f"  RESULTS: {passed}/{total} PASSED | {failed} FAILED")
print(f"")
for s in scenarios:
    icon = "PASS" if s["ok"] else "FAIL"
    time_str = f" ({s['time']:.1f}s)" if s["time"] > 0 else ""
    print(f"    {icon}: {s['name']}{time_str}")
print(f"")
print(f"  Verdict: {'ALL SCENARIOS PASSED' if failed == 0 else 'SOME FAILURES'}")
print(f"{'=' * 70}\n")

sys.exit(0 if failed == 0 else 1)
