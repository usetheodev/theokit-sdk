# ACP registry manifest

`agent.json` is the entry-point for the public Agent Client Protocol marketplace.

## Install in Zed

1. Install the package (or use `npx`): `npm i -g @theokit/acp` (optional — `npx` works too).
2. Copy this directory to `~/.config/zed/external_agents/usetheo-sdk/`:

```bash
mkdir -p ~/.config/zed/external_agents/usetheo-sdk
cp packages/acp/registry/* ~/.config/zed/external_agents/usetheo-sdk/
```

3. Edit `agent.json` to point `distribution.args.[--entry]` at your real entry file (the one that default-exports a `SDKAgent` or factory).
4. Restart Zed. Open the External Agents panel; `Theokit SDK` should appear.

## Distribution

- `distribution.type: "command"` — the host spawns `npx theokit-acp ...` per session.
- `${ZED_PROJECT_ROOT}` is interpolated by Zed before spawn.
- Per ADR D358, the standalone `npx theokit-acp` is shipped from `@theokit/acp/bin/theokit-acp.mjs` so users don't have to install `@theokit/cli`.

See `concepts/acp-server.mdx` for the full integration guide.
