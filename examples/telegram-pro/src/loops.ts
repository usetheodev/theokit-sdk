/**
 * /loop — schedule a recurring agent.send that delivers result to Telegram.
 *
 * Differs from /remind (which uses SDK Cron with cron expression syntax) in
 * that /loop:
 *   - takes natural duration ("30s", "2m", "1h")
 *   - delivers the agent's reply DIRECTLY to the user's Telegram chat
 *     (via bot.api.sendMessage), not just to the bot's stdout
 *   - lives in-memory only (lost on restart — intentional for testing)
 *
 * @internal to the example
 */

import type { Bot } from "grammy";

import type { AgentFactoryOptions } from "./agent.js";

export interface LoopRecord {
  id: string;
  chatId: number;
  durationMs: number;
  prompt: string;
  startedAt: number;
  fireCount: number;
  intervalHandle: NodeJS.Timeout;
}

const loops = new Map<string, LoopRecord>();

const MIN_DURATION_MS = 10_000; // 10s — avoid OpenRouter rate-limit (~10 req/min free)
const MAX_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

const DURATION_RE = /^(\d+)\s*([smh])$/i;

export function parseDuration(raw: string): { ms: number; label: string } | undefined {
  const m = raw.trim().match(DURATION_RE);
  if (m === null) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : n * 3_600_000;
  if (ms < MIN_DURATION_MS) return undefined;
  if (ms > MAX_DURATION_MS) return undefined;
  return { ms, label: `${n}${unit}` };
}

export interface ScheduleLoopOptions {
  chatId: number;
  duration: string;
  prompt: string;
  bot: Bot;
  factoryOpts: AgentFactoryOptions;
  /**
   * Called on each fire to drive the agent + get a reply. Lives outside this
   * module so /loop can reuse the same dispatch path as regular messages.
   */
  fire: (prompt: string, chatId: number) => Promise<string>;
}

export function scheduleLoop(opts: ScheduleLoopOptions):
  | { ok: true; record: LoopRecord }
  | { ok: false; reason: string } {
  const parsed = parseDuration(opts.duration);
  if (parsed === undefined) {
    return {
      ok: false,
      reason: `Duração inválida "${opts.duration}". Use 30s, 2m ou 1h (mínimo 10s, máximo 24h).`,
    };
  }
  if (opts.prompt.trim().length === 0) {
    return { ok: false, reason: "Prompt vazio. Use /loop 30s <prompt>." };
  }

  const id = `loop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const handle = setInterval(() => {
    void runFire(id, opts).catch((err) => {
      console.error(`[loop ${id}] fire failed:`, err);
    });
  }, parsed.ms);

  const record: LoopRecord = {
    id,
    chatId: opts.chatId,
    durationMs: parsed.ms,
    prompt: opts.prompt,
    startedAt: Date.now(),
    fireCount: 0,
    intervalHandle: handle,
  };
  loops.set(id, record);
  return { ok: true, record };
}

async function runFire(id: string, opts: ScheduleLoopOptions): Promise<void> {
  const rec = loops.get(id);
  if (rec === undefined) return; // cancelled mid-flight
  rec.fireCount += 1;
  try {
    const reply = await opts.fire(opts.prompt, opts.chatId);
    const header = `🔁 loop ${id} (#${rec.fireCount})\n\n`;
    await opts.bot.api.sendMessage(opts.chatId, header + reply.slice(0, 3500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await opts.bot.api.sendMessage(
      opts.chatId,
      `🔁 loop ${id} (#${rec.fireCount}) — falha: ${msg.slice(0, 300)}`,
    );
  }
}

export function listLoops(chatId?: number): LoopRecord[] {
  const all = Array.from(loops.values());
  return chatId === undefined ? all : all.filter((r) => r.chatId === chatId);
}

export function stopLoop(id: string): LoopRecord | undefined {
  const rec = loops.get(id);
  if (rec === undefined) return undefined;
  clearInterval(rec.intervalHandle);
  loops.delete(id);
  return rec;
}

export function stopAllLoopsForChat(chatId: number): number {
  let stopped = 0;
  for (const [id, rec] of loops.entries()) {
    if (rec.chatId === chatId) {
      clearInterval(rec.intervalHandle);
      loops.delete(id);
      stopped += 1;
    }
  }
  return stopped;
}
