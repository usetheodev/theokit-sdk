# Hooks policy

File-based `.theokit/hooks.json` gates the real shell tool. The
`preToolUse` hook runs a tiny Node script that reads the tool input from
stdin and exits non-zero (= deny) when the shell command contains
`rm`, `sudo`, or `>>`. Allowed commands run unchanged.

Hooks are **file-based only** by design — there is no programmatic hook
API. This makes them a project-level policy boundary rather than a
per-run knob; they live in the repo and follow the same review trail as
the rest of the code.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Writes a workspace under `./workspace/` containing
   `.theokit/hooks.json` plus a `.theokit/policy.js` script that
   inspects the tool input.
2. Spawns a local agent with `local.settingSources: ["project"]` so the
   hook config gets picked up.
3. Sends a prompt that asks for **two** shell commands — one safe
   (`ls`), one dangerous (`rm -rf .`).
4. The agent loop runs the policy hook before each shell call. The
   first call succeeds; the second hits the regex, the script writes
   "Policy denied: …" to stderr and exits 1, the SDK returns
   `exitCode: 126` to the model with the reason as stderr.

## Expected output

```
Workspace: /path/to/examples/hooks-policy/workspace
→ shell: ls
✓ exit 0: README.md

→ shell: rm -rf .
✖ blocked by hook (exit 126): Policy denied: dangerous shell command (rm -rf .)

The `ls` command listed README.md. The `rm -rf .` command was rejected
by the project policy and did not run.

[status=finished duration=3920ms]
```

## Hook events available

| Event | When it fires | Common use |
| --- | --- | --- |
| `preRun` | Before `agent.send()` reaches the LLM | Reject prompts you don't want sent |
| `postRun` | After the run finishes | Audit logs, metric export |
| `preToolUse` | Before any tool dispatch | This example — command policy |
| `postToolUse` | After tool dispatch returns | Observability of tool stdout |
| `stop` | When the agent is being disposed | Cleanup |

Each hook entry can include a `matcher` regex to scope it to specific
tools (e.g. `"^shell$"` here).
