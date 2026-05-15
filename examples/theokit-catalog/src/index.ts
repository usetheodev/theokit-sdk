import { Theokit } from "@usetheo/sdk";

/**
 * `Theokit` namespace catalog. Three reads:
 *   - `Theokit.me()`              → API key + user identity
 *   - `Theokit.models.list()`    → available models + parameters
 *   - `Theokit.repositories.list()` → connected SCM repos
 *   - `Theokit.providers.list()` → provider catalog with capabilities
 *
 * Routes to:
 *   - Real HTTP when `THEOKIT_API_BASE_URL` is set (production / staging).
 *   - Deterministic fixture data when the API key starts with `theo_test_`
 *     and no base URL is configured.
 *
 * This example uses fixture mode so it runs everywhere — the PaaS
 * isn't deployed yet. When PaaS goes GA, swap the fixture key for
 * a real `THEOKIT_API_KEY` + `THEOKIT_API_BASE_URL` to hit the live
 * catalog.
 */

async function main(): Promise<void> {
  const me = await Theokit.me({ apiKey: process.env.THEOKIT_API_KEY });
  console.log(`me.apiKeyName: ${me.apiKeyName}`);
  console.log(`me.userEmail:  ${me.userEmail}`);

  const models = await Theokit.models.list({ apiKey: process.env.THEOKIT_API_KEY });
  console.log(`\nmodels (${models.length}):`);
  for (const m of models) {
    const variants = (m.variants ?? []).map((v) => v.displayName).join(", ");
    console.log(`  - ${m.id} (${m.displayName}) variants: ${variants || "(none)"}`);
  }

  const repos = await Theokit.repositories.list({ apiKey: process.env.THEOKIT_API_KEY });
  console.log(`\nrepos (${repos.length}):`);
  for (const r of repos) console.log(`  - ${r.url}`);

  const providers = await Theokit.providers.list({ apiKey: process.env.THEOKIT_API_KEY });
  console.log(`\nproviders (${providers.length}):`);
  for (const p of providers) {
    console.log(`  - ${p.name} (${p.displayName}) available=${p.isAvailable} caps=${p.capabilities.join(",")}`);
  }
}

main().catch((cause) => {
  console.error("theokit-catalog failed:", cause);
  process.exit(1);
});
