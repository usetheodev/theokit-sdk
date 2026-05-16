import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent, type SDKAgent } from "@usetheo/sdk";

/**
 * Plugin discovery from `.theokit/plugins/<name>/plugin.json`.
 *
 * Plugins are file-based extension manifests that the SDK discovers when
 * `local.settingSources` includes `"plugins"`. Each manifest declares the
 * plugin's name, version, capabilities, and entrypoint.
 *
 * This example creates an in-memory `.theokit/plugins/` tree with one
 * plugin manifest, then loads the agent with plugins enabled and inspects
 * `agent.plugins.list()`.
 */

interface AgentWithPlugins extends SDKAgent {
  plugins?: { list: () => Promise<Array<{ name: string; version: string; source: string }>> };
}

async function main(): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-plugins-walkthrough-"));
  const pluginDir = join(cwd, ".theokit", "plugins", "search-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        name: "search-plugin",
        version: "1.0.0",
        capabilities: ["chat"],
        entry: "plugin.js",
      },
      null,
      2,
    ),
    "utf8",
  );
  // Plugin entrypoint stub — required to exist so the loader validates
  // capabilities cleanly.
  await writeFile(
    join(pluginDir, "plugin.js"),
    "// Plugin entrypoint placeholder — would export provider/tool factories.\n",
    "utf8",
  );

  const agent = (await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_plugins_walkthrough",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    local: { cwd, settingSources: ["plugins"] },
    plugins: { enabled: ["search-plugin"] },
  })) as AgentWithPlugins;

  const list = (await agent.plugins?.list()) ?? [];
  console.log(`Discovered ${list.length} plugin(s):`);
  for (const p of list) {
    console.log(`  - ${p.name}@${p.version}`);
    console.log(`    source: ${p.source}`);
  }

  await agent.dispose();
}

main().catch((cause) => {
  console.error("plugins-walkthrough failed:", cause);
  process.exit(1);
});
