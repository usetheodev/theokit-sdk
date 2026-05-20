# plugins-walkthrough

`.theokit/plugins/<name>/plugin.json` discovery — file-based plugin
manifest loading.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

When `AgentOptions.local.settingSources` includes `"plugins"` and
`plugins.enabled` lists a plugin name, the SDK reads
`.theokit/plugins/<name>/plugin.json` and registers the plugin's
capabilities (chat, embedding, tools, …).

This example synthesizes a one-plugin tree in tmpfs:

```
.theokit/plugins/search-plugin/
├── plugin.json     # { name, version, capabilities, entry }
└── plugin.js       # entry stub
```

Then loads the agent with `plugins: { enabled: ["search-plugin"] }` and
prints `agent.plugins.list()`.

## Cloud agents

Plugins reach Cloud agents via `cloud.repos` clone — PaaS reads the
plugin manifest from the cloned repo (ADR D15). Local-path plugins
(absolute or relative paths) are rejected at create-time with
`cloud_plugin_path_rejected` (ADR D16).
