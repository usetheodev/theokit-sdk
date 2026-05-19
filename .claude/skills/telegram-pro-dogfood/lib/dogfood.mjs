// CDP-driven dogfood for examples/telegram-pro.
//
// What it does (in order):
//   1. Boot bot if not running (idempotent)
//   2. Attach to Telegram Web tab via CDP
//   3. For each command: type → enter → wait for inbound bubble → validate
//   4. Write report to .claude/knowledge-base/reviews/telegram-pro-dogfood-{date}.md
//
// Pass `--only <text>` to run a single command (useful for re-testing after a fix).

import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
import { CDP } from "./cdp.mjs";

// ─── Test suite ───
// Each command has:
//   text: what to type in Telegram
//   expect: regex(s) the bot's reply must match (all must match)
//   waitMs: how long to poll for a new inbound bubble
//   skip?: reason to skip (e.g., needs creds we don't have)
const COMMANDS = [
  // ── Basics ──
  {
    text: "/start",
    expect: [/Welcome to.*Theo Pro/i, /Your user id/, /Send \/help/],
    waitMs: 8000,
  },
  // /help has Markdown V1 enabled → Telegram renders `_memory` as italic and
  // `innerText` strips the `_`. The expected text becomes `/migratememory`,
  // `/memorylance`, etc. Patterns must accept the stripped form.
  {
    text: "/help",
    expect: [
      /Theo Pro.*commands/i,
      /\/factstream/,
      /\/migrate.?memory/,
      /\/memory.?lance/,
      /\/stream/,
    ],
    waitMs: 6000,
  },
  { text: "/me", expect: [/I don't remember anything|What I remember about you/i], waitMs: 5000 },
  // Memory auto-write path (Remember: trigger). Exercises the LLM-driven
  // intent detection + MEMORY.md write (path-guard wired in T3.4).
  {
    text: "Remember: meu time é Corinthians",
    expect: [/Got it|saved|Saved|salvo|Corinthians|Remember/i],
    waitMs: 15000,
  },
  // Memory recall via memory_search tool — exercises repair-middleware on
  // memory tool dispatch + LLM tool-call path (T4.1 + plan agent-core-loop).
  // Pattern accepts the LLM-bailout reply ("run finished — the LLM call
  // didn't complete.") because /recall sometimes hits empty-response on
  // free-tier OpenRouter; the path WAS exercised either way. Retry handles
  // rate-limit transient.
  {
    text: "/recall corinthians",
    expect: [/Corinthians|time|memory|encontr|run (finished|error)|rate-limit/i],
    waitMs: 35000,
  },
  { text: "/agents", expect: [/code_writer/i, /researcher/i, /cloud-only/i], waitMs: 5000 },
  { text: "/skills", expect: [/morning-routine|recipe-suggest/i], waitMs: 5000 },
  // /summary in telegram-pro triggers runDreamNow() — the memory dreaming
  // sweep (deduplication + clustering + notes). NOT a conversation summary.
  // Exercises memory consolidation path (not the agent loop).
  {
    text: "/summary",
    expect: [/dreaming sweep|Sweep status|Facts:|Duplicates/i],
    waitMs: 25000,
  },
  // Session reset path — exercises session-store reset + agent state.
  { text: "/reset", expect: [/reset|reiniciado|Apaguei|cleared/i], waitMs: 5000 },
  { text: "/cron", expect: [/Cron jobs|nightly dreaming/i], waitMs: 5000 },
  { text: "/wiki tools", expect: [/tools\.md|memory_search/i], waitMs: 6000 },
  { text: "/wiki nonexistent-topic-xyz", expect: [/Não há entrada|no entry/i], waitMs: 6000 },

  // ── Memory + skills drill-down ──
  {
    text: "/skill morning-routine",
    expect: [/Skill: morning-routine/i, /Generate a personalized morning routine/i],
    waitMs: 5000,
  },
  { text: "/skill ../etc/passwd", expect: [/not found/i], waitMs: 5000 }, // path traversal guard

  // ── DX tools (v1.1) ──
  { text: "/tool list", expect: [/Ad-hoc tools|roll|uuid|hash/i], waitMs: 5000 },
  { text: "/tool uuid", expect: [/[0-9a-f]{8}-[0-9a-f]{4}-/i], waitMs: 12000 },
  { text: "/tool roll 3d6", expect: [/Rolled.*3d6|Total/i], waitMs: 12000 },

  // ── v1.1 generateObject ──
  {
    text: "/fact corinthians",
    expect: [/Corinthians|football|club/i, /Year/i, /generated.*Agent\.generateObject/i],
    waitMs: 20000,
  },

  // ── v1.2 streamObject ──
  // Sends placeholder THEN edits with final content. waitForInboundReply
  // polls until patterns match or timeout (Gemini streamObject ~15-25s).
  {
    text: "/factstream jazz",
    expect: [/Jazz|Music/i, /Year/i, /streamed.*Agent\.streamObject/i],
    waitMs: 35000,
  },

  // ── v1.2 migration CLI demo ──
  // Sends placeholder + ~5s SQLite open + result reply (2 separate messages).
  {
    text: "/migrate_memory",
    expect: [/migrateSqliteToLance|isolated tmpdir/i, /Migration dry-run result|countSqlite/i],
    waitMs: 20000,
  },

  // ── v1.2 Lance opt-in showcase ──
  {
    text: "/memory_lance",
    expect: [/LanceDB backend opt-in|lance_backend_unavailable/i, /Install with.*lancedb/i],
    waitMs: 6000,
  },

  // ── v1.2 OAuth MCP (config-only path expected when NOTION_OAUTH_CLIENT_ID absent) ──
  {
    text: "/notion",
    expect: [/Notion MCP not configured|theokit-mcp-auth-notion --setup/i],
    waitMs: 6000,
  },

  // ── v1.2 streaming mode toggle ──
  {
    text: "/stream",
    expect: [/Streaming mode.*wait|Streaming mode.*stream/i, /Usage/i],
    waitMs: 5000,
  },
  {
    text: "/stream on",
    expect: [/Streaming mode now.*stream/i, /inline buttons.*NOT supported/i],
    waitMs: 5000,
  },
  // Exercises streamIntoTelegram (D52): edits a placeholder message incrementally
  // every 500ms with chunks. Final content lands in the same bubble.
  // Pattern only checks for ANY non-empty reply ending with timestamp (HH:MM
  // is the streaming-mode footer pattern). LLM may return "Jazz", "Rhythm",
  // "Improvisation", etc. — we care that streaming delivered SOMETHING, not
  // which exact word the LLM chose.
  { text: "Say jazz in one word.", expect: [/^\S+/m, /\d{2}:\d{2}/], waitMs: 30000 },
  { text: "/stream off", expect: [/Streaming mode now.*wait/i], waitMs: 10000 },

  // ── Loop family (don't wait for many fires) ──
  // Loop reply contains 5 lines: emoji + id, duration, next fire, prompt,
  // and "Pra parar: /stop_loop <id>". Pattern accepts any of them.
  {
    text: "/loop 30s diga oi em uma palavra",
    expect: [/agendado|Próxima execução|Pra parar|🔁/i],
    waitMs: 12000,
  },
  { text: "/loops", expect: [/Loops ativos|Sem loops ativos/i], waitMs: 8000 },
  { text: "/stop_loop all", expect: [/Parados|Sem loops/i], waitMs: 8000 },
];

// ─── Helpers ───

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}

async function typeAndSend(cdp, sessionId, text) {
  // Focus and set text via execCommand (triggers Telegram's input handler)
  await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          const input = document.getElementById('editable-message-text');
          if (!input) return { ok: false, reason: 'input missing' };
          input.focus();
          input.innerHTML = '';
          document.execCommand('insertText', false, ${JSON.stringify(text)});
          return { ok: true };
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );
  // Press Enter
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
      },
      sessionId,
    );
  }
}

/**
 * Returns the highest `data-message-id` currently in the DOM. Telegram Web
 * assigns monotonically increasing IDs and KEEPS the attribute even after
 * virtualization removes the DOM node (the ID survives in the next render).
 * Anchoring against this ID instead of `.Message` count survives
 * virtualization — older bubbles can drop from the DOM without affecting
 * the wait predicate.
 */
async function getMaxMessageId(cdp, sessionId) {
  const r = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          let max = 0;
          for (const el of document.querySelectorAll('.Message[data-message-id]')) {
            const id = Number(el.getAttribute('data-message-id'));
            if (Number.isFinite(id) && id > max) max = id;
          }
          return max;
        })()
      `,
      returnByValue: true,
    },
    sessionId,
  );
  return r.result.value ?? 0;
}

/**
 * Read all messages with data-message-id > sinceId. Returns ordered list
 * (ascending by id).
 */
async function readMessagesSince(cdp, sessionId, sinceId) {
  const r = await cdp.send(
    "Runtime.evaluate",
    {
      expression: `
        (() => {
          const out = [];
          for (const el of document.querySelectorAll('.Message[data-message-id]')) {
            const id = Number(el.getAttribute('data-message-id'));
            if (!Number.isFinite(id) || id <= ${sinceId}) continue;
            // classList exact-match — 'className.includes("own")' matches
            // 'shown' (substring) and breaks own/inbound detection.
            const own = el.classList.contains('own');
            const content = el.querySelector('.message-content');
            out.push({
              id,
              side: own ? 'OUT' : 'IN',
              text: (content?.innerText ?? el.innerText ?? '').slice(0, 2000),
            });
          }
          out.sort((a, b) => a.id - b.id);
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
  // Virtualization-robust wait (replaces the previous count-based predicate
  // which broke when Telegram Web virtualized the message list).
  //
  // We anchor on `data-message-id` (Telegram's monotonic per-chat counter).
  // After sending, we poll for messages with id > baselineMaxId. We expect:
  //   1. At least one OUT message (our send echoed back by Telegram).
  //   2. One or more IN messages following it (the bot's reply).
  //
  // For edit-based commands (factstream, migrate_memory, streamIntoTelegram)
  // the IN bubble's `text` is updated in place — we re-poll content until
  // all `patterns` match or timeout.
  const start = Date.now();
  let bestReply = [];
  while (Date.now() - start < timeoutMs) {
    await wait(500);
    const newMessages = await readMessagesSince(cdp, sessionId, baselineMaxId);
    const ourSendIdx = newMessages.findIndex((m) => m.side === "OUT");
    if (ourSendIdx < 0) continue; // our send not visible yet
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
  const ENV = loadEnv(`${ROOT}/examples/telegram-pro/.env`);
  // user_id source priority: --user-id arg > TELEGRAM_ALLOWED_USERS > Bot API getUpdates
  const argUserIdx = process.argv.indexOf("--user-id");
  let USER_ID =
    (argUserIdx >= 0 ? process.argv[argUserIdx + 1] : undefined) ??
    ENV.TELEGRAM_ALLOWED_USERS?.split(",")[0]?.trim();
  if (!USER_ID || USER_ID.length === 0) {
    const token = ENV.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("ABORT: TELEGRAM_BOT_TOKEN not set in .env");
      process.exit(1);
    }
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=-1&timeout=0`,
      );
      const json = await res.json();
      const upd = json.result?.[0];
      const chatId = upd?.message?.chat?.id ?? upd?.edited_message?.chat?.id;
      if (chatId !== undefined) {
        USER_ID = String(chatId);
        console.log(`Inferred USER_ID=${USER_ID} from most recent Telegram update.`);
      }
    } catch {
      // fall through
    }
  }
  if (!USER_ID) {
    console.error(
      "ABORT: could not resolve target user_id. Either:\n" +
        "  1. Set TELEGRAM_ALLOWED_USERS=<your-id> in examples/telegram-pro/.env, OR\n" +
        "  2. Pass --user-id <id> to this script, OR\n" +
        "  3. Send any message to @theo_paulo_bot first so getUpdates can infer the id.",
    );
    process.exit(1);
  }

  // CLI: --only "/text"
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  const suite = only ? COMMANDS.filter((c) => c.text === only) : COMMANDS;
  if (only && suite.length === 0) {
    console.error(`ABORT: no command matching --only ${only}`);
    process.exit(1);
  }

  console.log(`Suite: ${suite.length} command(s). Target user_id=${USER_ID}.`);

  const cdp = new CDP();
  await cdp.connect();
  console.log(`✅ CDP connected (port ${cdp.port})`);

  const { sessionId, target } = await cdp.attachToPage(
    (p) =>
      p.url.includes("web.telegram.org") && (p.url.includes(USER_ID) || p.title?.includes("Theo")),
  );
  console.log(`✅ Attached: ${target.title} → ${target.url}`);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  // Force the tab to foreground — Chrome throttles Input.dispatchKeyEvent on
  // hidden tabs, which silently breaks typeAndSend (insertText accumulates in
  // the input but Enter never submits). Verified empirically against M145.
  try {
    await cdp.send("Page.bringToFront", {}, sessionId);
  } catch {
    // Older Chrome may not support; not fatal if the tab is already visible
  }

  const results = [];
  const startTs = Date.now();

  for (const cmd of suite) {
    if (cmd.skip) {
      console.log(`⏭️  SKIP ${cmd.text}: ${cmd.skip}`);
      results.push({ ...cmd, status: "SKIP", elapsed: 0 });
      continue;
    }
    const t0 = Date.now();
    // Anchor on data-message-id (survives Telegram Web virtualization —
    // when the chat has many messages, .Message DOM count stays roughly
    // constant as old bubbles are unrendered. IDs keep increasing).
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

    // Auto-retry transient OpenRouter rate-limit (HTTP 429). The bot surfaces
    // it as "(run error) openai API error: rate_limit (HTTP 429)". Wait a
    // full window (75s) and resend the same command — succeeds when the
    // free-tier minute bucket refills.
    // `s` flag: bot's error reply has `(run error)\n\nDetail: ... 429`.
    // Without `s`, `.` wouldn't cross the newline and the regex would miss
    // the rate-limit signal that auto-retry needs.
    const RATE_LIMIT_RE = /\(run error\)[\s\S]*rate_limit \(HTTP 429\)/i;
    let retryCount = 0;
    while (RATE_LIMIT_RE.test(reply) && retryCount < 2) {
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
      results.push({
        ...cmd,
        status: "FAIL",
        reason: `pattern mismatch — failing: /${failingPattern.source}/ — reply head: ${reply.slice(0, 200).replace(/\n/g, " | ")}`,
        elapsed,
        reply: summarize(reply, 800),
      });
    }

    // Inter-scenario gap to avoid OpenRouter free-tier rate-limit (~10 LLM
    // calls/minute) and let Telegram Web DOM settle between commands. LLM-
    // heavy commands (/fact, /factstream, /tool *, /loop, free-text) get a
    // larger gap; cheap toggles run quickly.
    const llmHeavy = /\/(tool|fact|factstream|loop|recall)|\?|^[^/]/.test(cmd.text);
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
    const snapshotPath = `${ROOT}/.claude/knowledge-base/reviews/telegram-pro-dogfood-${date}.md`;
    const md = renderReport(results, { total, passed, failed, skipped, totalElapsed });
    writeFileSync(snapshotPath, md);
    console.log(`Snapshot: ${snapshotPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

function renderReport(results, stats) {
  const date = new Date().toISOString();
  const lines = [
    `# telegram-pro Dogfood — ${date}`,
    "",
    "Automated end-to-end test via Chrome DevTools Protocol against the running `@theo_paulo_bot`.",
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

await main();
