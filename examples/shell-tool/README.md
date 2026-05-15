# Shell tool

Agent with the real `shell` tool — actual `child_process.spawn` exec
against a local workspace, with stdout/stderr/exitCode captured and fed
back into the LLM as `tool_result` content.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it does

1. Creates a `./workspace/` directory with a `package.json` and a
   `data.txt` containing the string `answer-is-42`.
2. Spawns a local agent with that directory as its `cwd`.
3. Asks the agent to inspect the workspace using shell. The agent loop:
   - Receives the prompt
   - Decides to call the `shell` tool (e.g. `ls`)
   - Reads `package.json` and `data.txt` via `cat`
   - Feeds the captured stdout back to the model
   - Produces a one-sentence summary including `answer-is-42`

## Expected output

```
Workspace: /path/to/examples/shell-tool/workspace
→ shell: ls
← data.txt
  package.json
→ shell: cat package.json
← {"name":"demo-repo","version":"1.0.0",...
→ shell: cat data.txt
← answer-is-42

This demo-repo workspace contains a Node.js package definition and a
data file whose contents read: answer-is-42.

[status=finished duration=4210ms]
```

The exact tool calls vary by model — some models will batch `ls` and
`cat` into one `&&` call, others will do them sequentially. The
streaming output reflects that.
