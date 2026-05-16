import { Agent } from "@usetheo/sdk";

/**
 * Cloud agent demo. Cloud agents:
 *   - Run inside a Theo PaaS-managed VM (no local cwd)
 *   - Clone repos at runtime
 *   - Optionally open a PR when the run finishes (`autoCreatePR`)
 *   - Expose `listArtifacts()` / `downloadArtifact()` for files
 *     produced inside the VM workspace
 *
 * Because the PaaS isn't deployed yet, this example uses fixture mode
 * (`theo_test_*` key + no `THEOKIT_API_BASE_URL`). The SDK emits the
 * cloud-shaped events (CREATING / RUNNING / FINISHED) and serves a
 * fixture artifact list so callers can write production code against
 * the cloud API today and switch to the live PaaS by changing env.
 */

async function main(): Promise<void> {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud_demo",
    model: { id: "google/gemini-2.0-flash-001" },
    cloud: {
      repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
      autoCreatePR: true,
    },
  });
  console.log(`Cloud agent created: ${agent.agentId} (cloud prefix bc-)`);

  const run = await agent.send("Open a PR that fixes the failing tests in this repo.");

  let firstStatus: string | undefined;
  for await (const event of run.stream()) {
    if (event.type === "status") {
      firstStatus = firstStatus ?? event.status;
      console.log(`[status] ${event.status}`);
    } else if (event.type === "assistant") {
      const text = event.message.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text.length > 0) console.log(`[assistant] ${text}`);
    }
  }
  const result = await run.wait();
  console.log(`\nfinal: status=${result.status} run=${result.id}`);
  if (result.git !== undefined) {
    for (const branch of result.git.branches ?? []) {
      console.log(`  branch ${branch.branch ?? "?"} repo=${branch.repoUrl} pr=${branch.prUrl ?? "(none)"}`);
    }
  }

  const artifacts = await agent.listArtifacts();
  console.log(`\nartifacts (${artifacts.length}):`);
  for (const a of artifacts) console.log(`  - ${a.path} (${a.sizeBytes} bytes)`);

  if (artifacts.length > 0) {
    const first = artifacts[0]!;
    const buffer = await agent.downloadArtifact(first.path);
    console.log(`\ndownloaded ${first.path} → ${buffer.length} bytes`);
  }
}

main().catch((cause) => {
  console.error("cloud-agent failed:", cause);
  process.exit(1);
});
