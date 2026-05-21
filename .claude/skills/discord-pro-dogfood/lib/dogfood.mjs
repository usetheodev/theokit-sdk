// CDP-driven dogfood for examples/discord-pro.
//
// What it does:
//   1. Boot bot if not running (idempotent)
//   2. Attach to Discord Web tab via CDP (the target channel URL)
//   3. For each command: type → enter → wait for inbound bubble → validate
//   4. Write report to .claude/knowledge-base/reviews/discord-pro-dogfood-{date}.md
//
// Pass `--only "<text>"` to run a single command.

import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { CDP } from "./cdp.mjs";

// ─── Test suite ───
// Each command has:
//   text: what to type in Discord (text-trigger `!cmd`)
//   expect: regex(es) the bot's reply must match (all must match)
//   waitMs: how long to poll for a new inbound message
//   skip?: reason to skip (envGate'd providers)
//   retryOnError?: auto-retry on transient `(run error) rate_limit` once after 75s
const COMMANDS = [
  // ── Config-only commands (no LLM) ──
  {
    text: "!start",
    expect: [/Welcome to Theo Pro/i, /Your user id/i, /Send.*!help/i],
    waitMs: 8000,
  },
  {
    text: "!help",
    expect: [/Theo Pro.*commands/i, /!personality/i, /!fact/i, /!recall/i],
    waitMs: 6000,
  },
  {
    text: "!me",
    expect: [/I don't remember anything|What I remember about you/i],
    waitMs: 5000,
  },
  {
    text: "!cron",
    expect: [/Cron jobs/i, /nightly dreaming|config-only probe/i],
    waitMs: 5000,
  },

  // ── Wiki search (filesystem grep, no LLM) ──
  {
    text: "!wiki tools",
    expect: [/tools|memory_search/i],
    waitMs: 6000,
  },
  {
    text: "!wiki nonexistent-topic-xyz",
    expect: [/No wiki entry/i],
    waitMs: 6000,
  },

  // ── Recall — LLM-driven via memory_search tool ──
  {
    text: "!recall jazz",
    expect: [/jazz|music|memory|No|encontr|run (finished|error)|rate.?limit/i],
    waitMs: 35000,
    retryOnError: true,
  },

  // ── v1.1 generateObject ──
  {
    text: "!fact corinthians",
    expect: [/Corinthians|football|club/i, /Year/i, /generated.*Agent\.generateObject/i],
    waitMs: 30000,
    retryOnError: true,
  },

  // ── Context files coverage ──
  {
    text: "!context",
    expect: [/Context files discovered/i, /AGENTS\.md|CLAUDE\.md|bot-readme/i],
    waitMs: 10000,
  },

  // ── Memory adapters (env-gated) ──
  {
    text: "!memory supermemory jazz",
    expect: [/Memory provider.*supermemory.*configured/i],
    waitMs: 10000,
    envGate: "SUPERMEMORY_API_KEY",
  },
  {
    text: "!memory honcho jazz",
    expect: [/Memory provider.*honcho.*configured/i],
    waitMs: 10000,
    envGate: "HONCHO_API_KEY",
  },
  {
    text: "!memory mem0 jazz",
    expect: [/Memory provider.*mem0.*configured/i],
    waitMs: 10000,
    envGate: "MEM0_API_KEY",
  },

  // ── Personality presets (Hermes #26, ADRs D160-D169) ──
  // discord-pro ships sample presets at examples/discord-pro/.theokit/personalities/
  // (coder.md, poet.md). These tests REQUIRE the presets to be present —
  // if they're missing, expect FAIL not fallback.
  {
    text: "!personality",
    expect: [/Available personalities/i, /coder/i, /poet/i],
    waitMs: 8000,
  },
  {
    text: "!personality coder",
    expect: [/Activated.*coder/i, /Concise, technical|Send any message/i],
    waitMs: 8000,
  },
  // Voice probe — with `coder` active, free text MUST come back code-flavored.
  // Personality preset body says "Answer in code or pseudo-code first; prefer
  // fenced code blocks". Real LLM via OpenRouter.
  {
    text: "How do I reverse a string?",
    expect: [/```|def |function |const |return|\[::-1\]|\.reverse/i],
    waitMs: 45000,
    retryOnError: true,
  },
  {
    text: "!personality poet",
    expect: [/Activated.*poet/i, /verse|Send any message/i],
    waitMs: 8000,
  },
  {
    text: "!personality none",
    expect: [/Personality cleared/i, /default voice/i],
    waitMs: 8000,
  },
  // Unknown preset → ConfigurationError with available list.
  {
    text: "!personality ghost",
    expect: [/not found/i, /Available:.*coder.*poet/i],
    waitMs: 8000,
  },

  // ── Dreaming sweep (memory consolidation) ──
  // Calls runDreamNow() directly (same as telegram-pro). Reply has the
  // status table with Facts/Duplicates/Clusters counters.
  {
    text: "!summary",
    expect: [/Sweep status/i, /Facts:/i, /Duplicates removed:/i],
    waitMs: 25000,
  },
];

// ─── Helpers ───

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {
    // env file missing is OK — we read process.env separately.
  }
  return env;
}

/**
 * Discord Web's message input is a contenteditable Slate.js node.
 * Selector: `div[role="textbox"][contenteditable="true"][aria-label]` —
 * Discord renders multiple textboxes (search, channel switcher) but the
 * MESSAGE box has `data-slate-editor="true"` AND aria-label starts with
 * "Message".
 */
async function typeAndSend(cdp, sessionId, text) {
  // Discord uses Slate.js; only CDP-level (trusted) input events reach
  // its handlers reliably. document.execCommand + dispatchEvent often
  // fail silently because the synthetic event has isTrusted=false.
  //
  // Sequence:
  //   1. Resolve input geometry via JS.
  //   2. Click the input center (CDP Input.dispatchMouseEvent — focuses
  //      it AND triggers Slate's onFocus).
  //   3. Clear any leftover via execCommand selectAll+delete.
  //   4. Insert text via Input.insertText (Slate listens to beforeinput).
  //   5. Press Enter via Input.dispatchKeyEvent (trusted → submits).
  const rect = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          const boxes = document.querySelectorAll(
            'div[role="textbox"][contenteditable="true"][data-slate-editor="true"]'
          );
          for (const b of boxes) {
            if ((b.getAttribute('aria-label') ?? '').startsWith('Message')) {
              const r = b.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }
          }
          return null;
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );
  const center = rect.result.value;
  if (center === null) throw new Error("Message input not found");

  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: center.x, y: center.y, button: "left", clickCount: 1 },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: center.x, y: center.y, button: "left", clickCount: 1 },
    sessionId,
  );
  await wait(200);

  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );

  await cdp.send("Input.insertText", { text }, sessionId);
  await wait(300);

  for (const type of ["keyDown", "keyUp"]) {
    await cdp.send(
      "Input.dispatchKeyEvent",
      {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: type === "keyDown" ? "\r" : undefined,
        unmodifiedText: type === "keyDown" ? "\r" : undefined,
      },
      sessionId,
    );
  }
}

/**
 * Discord Web messages live under `li[id^="chat-messages-"]`. Each `li` has
 * `id="chat-messages-<channel_id>-<message_id>"` where message_id is a
 * monotonic Discord snowflake. This survives virtualization — older messages
 * unrender but the IDs we tracked stay anchored.
 */
async function getMaxMessageId(cdp, sessionId) {
  const r = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          let max = 0n;
          for (const el of document.querySelectorAll('li[id^="chat-messages-"]')) {
            const parts = el.id.split('-');
            const id = parts[parts.length - 1];
            try {
              const n = BigInt(id);
              if (n > max) max = n;
            } catch {}
          }
          return max.toString();
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );
  return r.result.value ?? "0";
}

/**
 * Read all messages with id > sinceId (BigInt compare via string).
 * Returns ordered list (ascending) with side and text.
 *
 * Side detection: the message author's display name lives in
 * `h3 span[class*="username"]`. Bot replies show with a "BOT" badge —
 * we treat any message NOT authored by the current user as IN (bot reply).
 *
 * For simplicity we use a heuristic: messages where the author header has
 * the BOT tag class (or contains an Application Tag) are IN; others (the
 * user) are OUT.
 *
 * Even simpler heuristic that works: messages we just sent will have an
 * id > baseline AND will be in chronological order. The OUT message is
 * ours (the first message after baseline). The IN messages are the bot's
 * subsequent replies.
 */
async function readMessagesSince(cdp, sessionId, sinceIdStr) {
  const r = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          const out = [];
          const sinceId = BigInt(${JSON.stringify(sinceIdStr)});
          for (const el of document.querySelectorAll('li[id^="chat-messages-"]')) {
            const parts = el.id.split('-');
            const idStr = parts[parts.length - 1];
            let id;
            try { id = BigInt(idStr); } catch { continue; }
            if (id <= sinceId) continue;
            // Author detection: Discord includes 'Bot' badge on bot messages.
            // The application-tag span has aria-label="Application" OR text
            // "APP"/"BOT".
            const hasBotTag = el.querySelector('span[class*="botTag"]') !== null
              || el.querySelector('[aria-label*="Application"]') !== null
              || el.querySelector('[aria-label*="Bot"]') !== null;
            // Fallback: messages without an explicit author header are likely
            // continuations of the previous author's message group. We treat
            // those as same-side as the preceding message (filled later).
            const hasHeader = el.querySelector('h3') !== null;
            // Content: the message BODY lives at id="message-content-<snowflake>"
            // where the snowflake matches the LI's id. Critical: msg.reply()
            // creates a Discord reply that QUOTES the original — that quote
            // also has a message-content-* element (with the ORIGINAL's id).
            // Selecting the first match would return the quote text instead
            // of the body. We pin to the body via exact id match.
            const contentEl = el.querySelector('[id="message-content-' + idStr + '"]');
            const text = (contentEl?.innerText ?? el.innerText ?? '').slice(0, 4000);
            out.push({
              id: idStr,
              side: hasBotTag ? 'IN' : (hasHeader ? 'OUT' : 'CONT'),
              text,
              hasHeader,
            });
          }
          // Pass 2: resolve CONT entries to the side of the previous entry.
          let lastSide = 'OUT';
          for (const m of out) {
            if (m.side === 'CONT') m.side = lastSide;
            else lastSide = m.side;
          }
          // Sort by BigInt id ascending.
          out.sort((a, b) => {
            const aN = BigInt(a.id);
            const bN = BigInt(b.id);
            return aN < bN ? -1 : aN > bN ? 1 : 0;
          });
          return out;
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );
  return r.result.value ?? [];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: polling+match logic is clearer as one block
async function waitForInboundReply(cdp, sessionId, baselineMaxId, timeoutMs, patterns) {
  const start = Date.now();
  let bestReply = [];
  while (Date.now() - start < timeoutMs) {
    await wait(500);
    const newMessages = await readMessagesSince(cdp, sessionId, baselineMaxId);
    const ourSendIdx = newMessages.findIndex((m) => m.side === "OUT");
    if (ourSendIdx < 0) continue;
    const inAfter = newMessages.slice(ourSendIdx + 1).filter((m) => m.side === "IN");
    if (inAfter.length === 0) continue;

    bestReply = inAfter;
    if (patterns !== undefined) {
      const text = inAfter.map((b) => b.text).join("\n");
      if (patterns.every((p) => p.test(text))) return inAfter;
    } else {
      return inAfter;
    }
  }
  return bestReply;
}

function matchAll(text, patterns) {
  return patterns.every((p) => p.test(text));
}

function summarize(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// ─── Main ───

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestration entry point — splitting hurts readability
async function main() {
  const ROOT = "/home/paulo/Projetos/usetheo/theokit-sdk";
  const ENV = loadEnv(`${ROOT}/examples/discord-pro/.env`);

  // CLI: --only "/text"
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  const channelIdx = process.argv.indexOf("--channel-id");
  const overrideChannel = channelIdx >= 0 ? process.argv[channelIdx + 1] : undefined;
  const suite = only ? COMMANDS.filter((c) => c.text === only) : COMMANDS;
  if (only && suite.length === 0) {
    console.error(`ABORT: no command matching --only ${only}`);
    process.exit(1);
  }

  console.log(`Suite: ${suite.length} command(s).`);

  const cdp = new CDP();
  await cdp.connect();
  console.log(`✅ CDP connected (port ${cdp.port})`);

  // Match the Discord Web tab. The user typically opens
  // https://discord.com/channels/<guild_id>/<channel_id> — pass the channel
  // id via --channel-id or use any discord.com/channels/* tab.
  const { sessionId, target } = await cdp.attachToPage((p) => {
    if (!p.url.includes("discord.com/channels/")) return false;
    if (overrideChannel !== undefined) return p.url.includes(overrideChannel);
    return true;
  });
  console.log(`✅ Attached: ${target.title} → ${target.url}`);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  try {
    await cdp.send("Page.bringToFront", {}, sessionId);
  } catch {
    // ignore
  }

  const results = [];
  const startTs = Date.now();

  for (const cmd of suite) {
    if (cmd.skip) {
      console.log(`⏭️  SKIP ${cmd.text}: ${cmd.skip}`);
      results.push({ ...cmd, status: "SKIP", elapsed: 0 });
      continue;
    }
    if (cmd.envGate !== undefined) {
      const required = String(cmd.envGate);
      if (ENV[required] === undefined || ENV[required] === "") {
        console.log(`⏭️  SKIP ${cmd.text}: env ${required} unset`);
        results.push({
          ...cmd,
          status: "SKIP",
          elapsed: 0,
          reason: `env ${required} unset`,
        });
        continue;
      }
    }
    const t0 = Date.now();
    const baselineMaxId = await getMaxMessageId(cdp, sessionId);

    process.stdout.write(`▶ ${cmd.text}... `);
    try {
      await typeAndSend(cdp, sessionId, cmd.text);
    } catch (err) {
      console.log(`❌ send failed: ${err.message}`);
      results.push({
        ...cmd,
        status: "FAIL",
        reason: `send error: ${err.message}`,
        elapsed: Date.now() - t0,
        reply: "",
      });
      continue;
    }

    let inbound = await waitForInboundReply(cdp, sessionId, baselineMaxId, cmd.waitMs, cmd.expect);
    let reply = inbound.map((b) => b.text).join("\n");

    const RATE_LIMIT_RE = /\(run error\)[\s\S]*rate_limit \(HTTP 429\)/i;
    const BARE_ERROR_RE = /\(run error\)\s*(no result|$)/i;
    let retryCount = 0;
    while (
      retryCount < 2 &&
      (RATE_LIMIT_RE.test(reply) || (cmd.retryOnError === true && BARE_ERROR_RE.test(reply)))
    ) {
      retryCount += 1;
      process.stdout.write(`\n  ⏳ rate-limited, sleeping 75s before retry ${retryCount}... `);
      await wait(75000);
      const retryBaseline = await getMaxMessageId(cdp, sessionId);
      await typeAndSend(cdp, sessionId, cmd.text);
      inbound = await waitForInboundReply(cdp, sessionId, retryBaseline, cmd.waitMs, cmd.expect);
      reply = inbound.map((b) => b.text).join("\n");
    }
    const elapsed = Date.now() - t0;

    if (reply.length === 0) {
      console.log(`❌ timeout (${elapsed}ms, no inbound bubble)`);
      results.push({ ...cmd, status: "FAIL", reason: "timeout / no reply", elapsed, reply: "" });
      continue;
    }
    const matched = matchAll(reply, cmd.expect);
    if (matched) {
      console.log(`✅ ${elapsed}ms`);
      results.push({ ...cmd, status: "PASS", elapsed, reply: summarize(reply, 400) });
    } else {
      const failingPattern = cmd.expect.find((p) => !p.test(reply));
      console.log(`❌ pattern mismatch (failing: ${failingPattern.source.slice(0, 50)})`);
      console.log(`   reply head: ${reply.slice(0, 300).replace(/\n/g, " | ")}`);
      results.push({
        ...cmd,
        status: "FAIL",
        reason: `pattern mismatch — failing: /${failingPattern.source}/ — reply head: ${reply.slice(0, 200).replace(/\n/g, " | ")}`,
        elapsed,
        reply: summarize(reply, 800),
      });
    }

    // Inter-scenario gap to avoid OpenRouter free-tier rate-limit.
    const llmHeavy = /^!(fact|recall|summary|memory)|How |reverse/.test(cmd.text);
    await wait(llmHeavy ? 6000 : 1500);
  }

  cdp.close();

  // ─── Report ───
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const totalElapsed = Date.now() - startTs;

  console.log(`\n────────────────────────────────────────`);
  console.log(
    `Total: ${total} | PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped} | ${(totalElapsed / 1000).toFixed(1)}s`,
  );

  if (!only) {
    const date = new Date().toISOString().slice(0, 10);
    const snapshotPath = `${ROOT}/.claude/knowledge-base/reviews/discord-pro-dogfood-${date}.md`;
    const md = renderReport(results, { total, passed, failed, skipped, totalElapsed });
    writeFileSync(snapshotPath, md);
    console.log(`Snapshot: ${snapshotPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

function renderReport(results, stats) {
  const date = new Date().toISOString();
  const lines = [
    `# discord-pro Dogfood — ${date}`,
    "",
    "Automated end-to-end test via Chrome DevTools Protocol against the running discord-pro bot (`Theo Pro Dev#8265`).",
    "",
    `**Total:** ${stats.total} | **Pass:** ${stats.passed} ✅ | **Fail:** ${stats.failed} ❌ | **Skip:** ${stats.skipped} ⏭️ | **Elapsed:** ${(stats.totalElapsed / 1000).toFixed(1)}s`,
    "",
    "## Results",
    "",
    "| # | Command | Status | Elapsed | Notes |",
    "|---|---|---|---|---|",
  ];
  results.forEach((r, i) => {
    const status = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
    const notes = r.status === "FAIL" ? (r.reason ?? "") : "";
    lines.push(
      `| ${i + 1} | \`${r.text.replace(/\|/g, "\\|").slice(0, 60)}\` | ${status} ${r.status} | ${r.elapsed}ms | ${notes.slice(0, 100)} |`,
    );
  });
  lines.push("");
  if (stats.failed > 0) {
    lines.push("## Failures (detailed)");
    lines.push("");
    for (const r of results) {
      if (r.status !== "FAIL") continue;
      lines.push(`### \`${r.text}\``);
      lines.push("");
      lines.push(`**Reason:** ${r.reason}`);
      lines.push("");
      lines.push("**Actual reply:**");
      lines.push("```");
      lines.push(r.reply || "(empty / no reply)");
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
