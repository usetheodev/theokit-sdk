/**
 * Vertex AI access token + config resolution (ADRs D288, D295).
 *
 * Uses `google-auth-library` (required peer dep) for ADC discovery:
 *   1. `GOOGLE_APPLICATION_CREDENTIALS` env (path to Service Account JSON)
 *   2. `gcloud auth application-default login` cached credentials
 *   3. Metadata server (GCE/GKE/Cloud Run/Cloud Functions)
 *   4. Workload Identity Federation (WIF; configured via Service Account JSON)
 *
 * EC-3 absorbed: differentiate "peer dep missing" (throws ConfigurationError
 * with install hint) from "no credentials in ADC chain" (returns undefined
 * so caller can throw a clearer downstream error).
 *
 * @internal
 */

import { createRequire } from "node:module";

import { ConfigurationError } from "../../errors.js";

interface GoogleAuthClient {
  getAccessToken: () => Promise<{ token: string | null }>;
}

interface GoogleAuthLib {
  GoogleAuth: new (opts: { scopes: string[] }) => {
    getClient: () => Promise<GoogleAuthClient>;
  };
}

let cachedAuthClient: GoogleAuthClient | undefined;

const SCOPE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";

export async function resolveVertexAccessToken(): Promise<string | undefined> {
  if (cachedAuthClient === undefined) {
    cachedAuthClient = await getAuthClientOrThrow();
  }
  try {
    const result = await cachedAuthClient.getAccessToken();
    return result.token ?? undefined;
  } catch {
    // ADC chain exhausted — caller (router) emits the helpful error.
    return undefined;
  }
}

async function getAuthClientOrThrow(): Promise<GoogleAuthClient> {
  let mod: GoogleAuthLib;
  try {
    const r = createRequire(import.meta.url);
    mod = r("google-auth-library") as GoogleAuthLib;
  } catch (err) {
    // EC-3: differentiate module-not-found from runtime ADC failure.
    const isModuleMissing =
      err instanceof Error &&
      (err.message.includes("Cannot find module") ||
        (err as { code?: string }).code === "MODULE_NOT_FOUND");
    if (isModuleMissing) {
      throw new ConfigurationError(
        "Vertex provider requires `google-auth-library`. Install: `pnpm add google-auth-library`.",
        { code: "auth_failed", cause: err },
      );
    }
    throw err;
  }
  try {
    const auth = new mod.GoogleAuth({ scopes: [SCOPE_CLOUD_PLATFORM] });
    return await auth.getClient();
  } catch (err) {
    // ADC chain exhausted at client construction time — return a stub that
    // forces resolveVertexAccessToken to return undefined.
    process.stderr.write(
      `[theokit-sdk] Vertex ADC initialization failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return { getAccessToken: async () => ({ token: null }) };
  }
}

/** Resolve project id via env vars (env-only in v1). */
export function resolveVertexProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT_ID ??
    process.env.GCLOUD_PROJECT
  );
}

/** Resolve Vertex location (region) from env; defaults to `us-central1`. */
export function resolveVertexLocation(): string {
  return (
    process.env.GOOGLE_CLOUD_LOCATION ??
    process.env.CLOUD_ML_REGION ??
    "us-central1"
  );
}

/** Test seam — reset cached auth client. */
export function __resetVertexAuth(): void {
  cachedAuthClient = undefined;
}

/** Test seam — inject a custom client for unit tests. */
export function __setVertexAuthClientForTests(client: GoogleAuthClient | undefined): void {
  cachedAuthClient = client;
}
