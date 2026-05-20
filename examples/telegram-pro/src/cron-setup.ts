import { Cron, Memory, type CronJob } from "@usetheo/sdk";

/**
 * Cron wiring: nightly dreaming sweep + reminder support.
 *
 * On boot we:
 *   1. Register a daily 03:00 cron job (`tg-pro:nightly-dream`) that runs
 *      `Memory.runDreamingSweep` to dedup + cluster the user's facts.
 *   2. Call `Cron.start()` so the scheduler thread fires registered jobs.
 *
 * The /remind command appends ad-hoc cron jobs at runtime.
 *
 * @internal to the example
 */

const NIGHTLY_DREAM_ID = "tg-pro:nightly-dream";

/**
 * Idempotent: only creates the job if it doesn't already exist.
 * Returns the registered/existing job for logging.
 */
async function ensureNightlyDream(cwd: string, apiKey: string): Promise<CronJob | undefined> {
  // Check if Memory.runDreamingSweep has a usable embedding provider; if not,
  // skip the cron — the sweep would just error out every night.
  const hasEmbedder =
    process.env.OPENAI_API_KEY !== undefined ||
    process.env.MISTRAL_API_KEY !== undefined ||
    process.env.OPENROUTER_API_KEY !== undefined;
  if (!hasEmbedder) {
    console.warn("[cron] no embedding provider key — skipping nightly dream registration");
    return undefined;
  }

  try {
    const existing = await Cron.get(NIGHTLY_DREAM_ID);
    if (existing.enabled) return existing;
    return await Cron.enable(NIGHTLY_DREAM_ID);
  } catch {
    // Not registered — create it.
  }

  return Cron.create({
    cron: "0 3 * * *", // 03:00 every day, local timezone (UTC default)
    name: "Nightly dreaming sweep",
    message: "Run the nightly memory consolidation.",
    apiKey,
    agent: {
      apiKey,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
      systemPrompt:
        "You are a cron worker. When invoked, do not chat — just acknowledge in one short sentence and stop.",
    },
  });
}

/**
 * Run the dreaming sweep right now (used by /summary command). Picks the
 * cheapest available embedding provider.
 */
export async function runDreamNow(cwd: string) {
  const provider = process.env.OPENAI_API_KEY
    ? "openai"
    : process.env.MISTRAL_API_KEY
      ? "mistral"
      : "openrouter";
  const model =
    provider === "openrouter"
      ? "openai/text-embedding-3-small"
      : provider === "openai"
        ? "text-embedding-3-small"
        : "mistral-embed";
  return Memory.runDreamingSweep({
    cwd,
    embedding: { provider, model },
  });
}

export async function initCron(cwd: string, apiKey: string): Promise<void> {
  await ensureNightlyDream(cwd, apiKey);
  await Cron.start({ cwd });
}

export async function listCronJobs(): Promise<CronJob[]> {
  const result = await Cron.list();
  return result.items;
}

/**
 * Quick-and-dirty /remind: schedule a one-shot fire at the specified time.
 * Format: cron expression directly (POSIX 5-field). Examples:
 *   "0 8 * * 1"   = every Monday at 08:00
 *   "0 14 25 12 *" = Dec 25 at 14:00
 * The bot dispatches the agent with the user's message on each fire.
 */
export async function scheduleReminder(opts: {
  cwd: string;
  apiKey: string;
  cron: string;
  message: string;
  userId: string;
}): Promise<CronJob> {
  const id = `tg-pro:remind:${opts.userId}:${Date.now()}`;
  return Cron.create({
    cron: opts.cron,
    name: `Reminder for ${opts.userId}`,
    message: `[reminder fire] ${opts.message}`,
    apiKey: opts.apiKey,
    agent: {
      agentId: id,
      apiKey: opts.apiKey,
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: opts.cwd },
      memory: { enabled: false },
      systemPrompt:
        "You are a Telegram reminder bot. Echo the reminder text back in 1 sentence so the user sees it on their phone. Do not chat further.",
    },
  });
}
