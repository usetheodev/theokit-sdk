# example: vertex-bot

One-shot Gemini (or Claude) prompt via GCP Vertex AI (`@usetheo/sdk` Adoption Roadmap #8; ADRs D286-D302).

## Setup

1. Enable Vertex AI API in your GCP project: <https://console.cloud.google.com/apis/library/aiplatform.googleapis.com>.
2. Grant your principal the **Vertex AI User** role (`roles/aiplatform.user`).
3. Authenticate via ADC (Application Default Credentials):
   ```bash
   gcloud auth application-default login
   gcloud config set project <your-gcp-project>
   ```
4. (Optional, production) Use a service account instead:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json
   ```
5. Copy `.env.example` to `.env` and set `GOOGLE_CLOUD_PROJECT`.

## Run

```bash
cp .env.example .env
# fill GOOGLE_CLOUD_PROJECT
pnpm install
pnpm run run                                            # default question
pnpm run run "What's 2+2?"
VERTEX_MODEL=vertex/anthropic/claude-sonnet-4-5@20250929 pnpm run run  # Claude on Vertex
```

## Model IDs

- **Gemini (OpenAI-compat path, D291):** `vertex/google/gemini-2.0-flash-001`
- **Claude (`:rawPredict` path, D292):** `vertex/anthropic/claude-sonnet-4-5@20250929`

## Locations

- `us-central1`, `europe-west4`, `asia-southeast1`, etc — regional routing.
- `global` — cross-region for Anthropic (Vertex global endpoint with D293 baseUrl fix).

## v1 limitations (documented)

- **`google-auth-library` required peer dep** (D288) — repo archived Nov 2025 but security-patched.
- **OpenAI-compat path drops unsupported params silently** (D291) — e.g. recursive JSON schemas in `response_format`. Documented in Vertex's own docs.
- **Anthropic on Vertex is non-streaming** in v1 — `:streamRawPredict` deferred to v1.x; v1 always uses `:rawPredict`.
- **No Workload Identity Federation walkthrough** in v1 (D297) — ADC chain resolves it transparently, but the GCP-side setup is out of scope.
- **No Service Account JSON file generation tooling** (D299) — user provides via `GOOGLE_APPLICATION_CREDENTIALS`.
