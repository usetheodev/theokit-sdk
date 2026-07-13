#!/usr/bin/env node
// Examples validation workspace — local dev server.
//
// Lists every example under examples/ (manifest.json metadata when present),
// serves the code + README, and executes `run.ts` against a real provider,
// streaming stdout/stderr to the browser as NDJSON.
//
// Run: pnpm run examples:workspace   (binds 127.0.0.1 only)
//
// Provider keys are inherited from this process env + the repo-root .env +
// the example's own .env. Key VALUES are never sent to the client — only
// boolean presence per PROVIDER_ENV_KEYS.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverExamples,
  isSafeSlug,
  mergeEnv,
  PROVIDER_ENV_KEYS,
  parseEnvFile,
  resolveRunCommand,
  stripAnsi,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const EXAMPLES_DIR = join(ROOT, "examples");
const PORT = Number(process.env.PORT ?? 4680);
const HOST = "127.0.0.1";

/** slug → { child, startedAt } for run-in-flight bookkeeping. */
const running = new Map();

async function readFileOrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function loadManifest() {
  const raw = await readFileOrNull(join(EXAMPLES_DIR, "manifest.json"));
  if (raw === null) return { examples: [] };
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("manifest.json unparseable:", error.message);
    return { examples: [] };
  }
}

async function buildChildEnv(exampleDir) {
  const rootEnv = await readFileOrNull(join(ROOT, ".env"));
  const exampleEnv = await readFileOrNull(join(exampleDir, ".env"));
  return mergeEnv(
    process.env,
    rootEnv === null ? {} : parseEnvFile(rootEnv),
    exampleEnv === null ? {} : parseEnvFile(exampleEnv),
  );
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function writeEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

function killProcessGroup(child, signal) {
  if (child.pid === undefined || child.exitCode !== null || child.killed) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone — nothing to kill
    }
  }
}

/** Spawn one phase (install|run), streaming output; resolves with the exit code. */
function streamPhase(res, slug, phase, command, args, options) {
  return new Promise((resolvePhase, rejectPhase) => {
    writeEvent(res, {
      type: "phase",
      phase,
      command: `${command.split("/").pop()} ${args.join(" ")}`,
    });
    const child = spawn(command, args, {
      ...options,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    running.set(slug, { child, startedAt: Date.now() });

    child.stdout.on("data", (chunk) =>
      writeEvent(res, { type: "stdout", data: stripAnsi(chunk.toString()) }),
    );
    child.stderr.on("data", (chunk) =>
      writeEvent(res, { type: "stderr", data: stripAnsi(chunk.toString()) }),
    );
    child.on("error", (error) => rejectPhase(error));
    child.on("close", (code, signal) => resolvePhase({ code, signal }));
  });
}

async function handleRun(_req, res, example) {
  if (running.has(example.slug)) {
    sendJson(res, 409, {
      error: `"${example.slug}" já está em execução — pare antes de rodar de novo.`,
    });
    return;
  }
  const exampleDir = join(EXAMPLES_DIR, example.slug);
  const runCommand = resolveRunCommand({ rootDir: ROOT, exampleDir, hasRunTs: example.runnable });
  if (runCommand === null) {
    sendJson(res, 422, {
      error: `"${example.slug}" não tem run.ts — rode manualmente (veja o README).`,
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });

  // Client disconnect (tab closed / refresh) kills the child — no orphan bots.
  res.on("close", () => {
    const entry = running.get(example.slug);
    if (entry !== undefined) {
      killProcessGroup(entry.child, "SIGTERM");
      running.delete(example.slug);
    }
  });

  const startedAt = Date.now();
  try {
    if (!example.installed) {
      const install = await streamPhase(
        res,
        example.slug,
        "install",
        "pnpm",
        ["install", "--ignore-workspace"],
        {
          cwd: exampleDir,
          env: process.env,
        },
      );
      if (install.code !== 0) {
        writeEvent(res, {
          type: "exit",
          phase: "install",
          code: install.code,
          signal: install.signal,
          durationMs: Date.now() - startedAt,
        });
        running.delete(example.slug);
        res.end();
        return;
      }
    }

    const env = await buildChildEnv(exampleDir);
    const result = await streamPhase(
      res,
      example.slug,
      "run",
      runCommand.command,
      runCommand.args,
      {
        cwd: runCommand.cwd,
        env,
      },
    );
    writeEvent(res, {
      type: "exit",
      phase: "run",
      code: result.code,
      signal: result.signal,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    writeEvent(res, { type: "error", message: error.message });
  } finally {
    running.delete(example.slug);
    res.end();
  }
}

async function handleStop(res, slug) {
  const entry = running.get(slug);
  if (entry === undefined) {
    sendJson(res, 404, { error: `"${slug}" não está em execução.` });
    return;
  }
  killProcessGroup(entry.child, "SIGTERM");
  setTimeout(() => killProcessGroup(entry.child, "SIGKILL"), 3000).unref();
  sendJson(res, 200, { stopped: slug });
}

async function findExample(slug) {
  if (!isSafeSlug(slug)) return null;
  const manifest = await loadManifest();
  const examples = await discoverExamples({ examplesDir: EXAMPLES_DIR, manifest });
  return examples.find((example) => example.slug === slug) ?? null;
}

async function serveIndex(_req, res) {
  const html = await readFile(join(__dirname, "public", "index.html"));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handleState(_req, res) {
  const manifest = await loadManifest();
  const examples = await discoverExamples({ examplesDir: EXAMPLES_DIR, manifest });
  const providers = Object.fromEntries(
    PROVIDER_ENV_KEYS.map((key) => [key, (process.env[key] ?? "").length > 0]),
  );
  sendJson(res, 200, { examples, providers, running: [...running.keys()] });
}

async function handleFilesRoute(_req, res, slug) {
  const example = await findExample(slug);
  if (example === null) {
    sendJson(res, 404, { error: "example não encontrado" });
    return;
  }
  const dir = join(EXAMPLES_DIR, example.slug);
  sendJson(res, 200, {
    code: await readFileOrNull(join(dir, "run.ts")),
    readme: await readFileOrNull(join(dir, "README.md")),
  });
}

async function handleRunRoute(req, res, slug) {
  const example = await findExample(slug);
  if (example === null) {
    sendJson(res, 404, { error: "example não encontrado" });
    return;
  }
  await handleRun(req, res, example);
}

async function handleStopRoute(_req, res, slug) {
  if (!isSafeSlug(slug)) {
    sendJson(res, 400, { error: "slug inválido" });
    return;
  }
  await handleStop(res, slug);
}

const ROUTES = [
  { method: "GET", pattern: /^\/$/, handler: serveIndex },
  { method: "GET", pattern: /^\/api\/state$/, handler: handleState },
  { method: "GET", pattern: /^\/api\/examples\/([^/]+)\/files$/, handler: handleFilesRoute },
  { method: "POST", pattern: /^\/api\/examples\/([^/]+)\/run$/, handler: handleRunRoute },
  { method: "POST", pattern: /^\/api\/examples\/([^/]+)\/stop$/, handler: handleStopRoute },
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  try {
    for (const route of ROUTES) {
      if (req.method !== route.method) continue;
      const match = url.pathname.match(route.pattern);
      if (match === null) continue;
      await route.handler(req, res, match[1]);
      return;
    }
    sendJson(res, 404, { error: "rota desconhecida" });
  } catch (error) {
    console.error(`${req.method} ${url.pathname} failed:`, error);
    if (!res.headersSent) sendJson(res, 500, { error: error.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`examples-workspace: http://${HOST}:${PORT}`);
  const present = PROVIDER_ENV_KEYS.filter((key) => (process.env[key] ?? "").length > 0);
  console.log(
    present.length > 0
      ? `provider keys detectadas no ambiente: ${present.join(", ")}`
      : "nenhuma provider key no ambiente do servidor — os examples ainda leem examples/<slug>/.env e o .env da raiz",
  );
});
