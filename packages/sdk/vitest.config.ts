import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * The ONLY suites the default `pnpm test` gate does not run, each with the reason it is
 * out and a sunset by which that reason must be gone or re-measured.
 *
 * `vitest.roadmap.config.ts` imports this list as its `include`, so the two files cannot
 * drift: deleting a path here gates it by default AND drops it from the roadmap run in
 * the same edit. The two lists used to be written by hand and had already diverged —
 * `tests/contract/error-codes.test.ts` and `tests/contract/registered-agent.test.ts`
 * matched the old default-gate exclusion (`tests/contract/**`) but not the roadmap
 * config's include (`tests/contract/**\/*.contract.test.ts`), so no command in the
 * repository ran them at all.
 *
 * B-048 measured the old blanket `tests/contract/**` exclusion on 2026-08-19: 27 files,
 * 94 cases, 88 passing, 6 failing — stable across three consecutive runs. Twenty-one
 * files (58 cases) were held out of the gate by the six below; they are gated now.
 *
 * Each entry states WHY. "Waits for the runtime adapters", which the previous comment
 * applied to the whole directory, is true of exactly two of the six.
 */
export const ROADMAP_ONLY_SUITES = [
  // ── Non-hermetic: reaches the public internet. ────────────────────────────────
  // Resolves instead of rejecting because the run reaches
  // generativelanguage.googleapis.com and comes back with
  // `google API error: invalid_request (HTTP 400) … "Please pass a valid API key"`.
  // A default gate that fails when the developer is offline is not a gate.
  // Owner: B-048 · sunset 2026-11-19 (stub the provider transport, then gate it).
  "tests/contract/agent-prompt.contract.test.ts",

  // ── Cloud runtime is pre-release; the endpoints do not exist yet. ─────────────
  // Both fail with `ConfigurationError: Cloud runtime is pre-release. Theo PaaS
  // endpoints are not wired yet`. This is the one class the old comment described
  // correctly. Owner: B-048 · sunset 2026-11-19 (gate them when the PaaS ships).
  "tests/contract/agent-management.contract.test.ts",
  "tests/contract/run-status-operations.contract.test.ts",

  // ── Cron manual run against an agent the registry never persisted. ────────────
  // `UnknownAgentError` / code `agent_not_registered` from
  // src/internal/cron/run-job.ts:61, downstream of a registry write that itself
  // failed (`registry persist failed … ENOENT … registry.json.<pid>.tmp ->
  // registry.json`). These two pin a real defect, not an unimplemented feature.
  // Owner: B-048 · sunset 2026-11-19.
  "tests/contract/cron.contract.test.ts",
  "tests/contract/cron-validation-matrix.contract.test.ts",

  // ── Order-dependent golden. ──────────────────────────────────────────────────
  // The golden pins `sources[0].name === "project-readme"`; the run yields
  // `architecture-note` first. That is readdir order, not behaviour, so the
  // assertion is testing the filesystem. Owner: B-048 · sunset 2026-11-19 (sort the
  // sources before comparing, or assert set membership).
  "tests/contract/context-manager.contract.test.ts",

  // ── Golden suites pinned to the same outstanding work. ────────────────────────
  // Carried over unchanged from the pre-2026-08-19 list; not re-measured by B-048.
  "tests/golden/agent-run.golden.test.ts",
  "tests/golden/catalog-cron-artifacts.golden.test.ts",
  "tests/golden/platform-extensions.golden.test.ts",
  "tests/golden/stream.golden.test.ts",
];

/**
 * Execution semantics shared by the default gate and the roadmap gate.
 *
 * Shared, not copied, because the copy had already gone wrong: `vitest.roadmap.config.ts`
 * declared no `setupFiles`, so `pnpm test:roadmap` ran its suites WITHOUT the per-test
 * THEOKIT_HOME isolation every other run gets, and reported failures the default gate
 * does not have. Reading its output as a RED count was reading the missing setup file.
 */
export const SHARED_TEST_OPTIONS = {
  environment: "node" as const,
  // Default 5s is too tight for e2e / first-import tests under the documented
  // libuv saturation of the full `pnpm -r run test` (18 packages in parallel —
  // see the forks-pool note below). Raise to 20s so load variance never flakes;
  // a genuine hang still fails (real hangs run indefinitely, not ~5-6s).
  testTimeout: 20_000,
  hookTimeout: 20_000,
  // Autouse setup: isolates THEOKIT_HOME per-test in a fresh tmpdir
  // (T6.1, ADR D60). Tests never write to the developer's real state.
  // Also runs native-bindings preflight (T1.1, dogfood-regressions-fix v1.1).
  setupFiles: ["./vitest.setup.ts"],
  // theokit-sdk-biome-cleanup 2026-05-30 — ALL SDK tests run in the forks
  // pool, each file in its OWN subprocess. Reasons:
  //
  // 1. process.env.HOME race: tests in `internal/providers/discovery.test.ts`,
  //    `internal/runtime/context-import-resolver.test.ts`,
  //    `internal/personality/{registry,switch,resolver,store}.test.ts`,
  //    and `agent-personality-direct-api.test.ts` mutate `process.env.HOME`
  //    in `beforeEach`/`afterEach`. The threads pool (vitest default) shares
  //    one Node process across worker threads, so HOME mutations race.
  //
  // 2. libuv saturation under `pnpm -r run test` (full validate): 18
  //    packages run vitest in parallel; the threads pool's libuv worker
  //    pool gets saturated and `import()`/FS calls race nondeterministically.
  //    The forks pool (subprocess) sidesteps both classes of races.
  //
  // 3. dogfood-regressions-fix-plan v1.1 T3.1 (integration tests):
  //    integration tests with real I/O (Ollama HTTP, etc.) + long timeouts
  //    (120s) already required the forks pool. Routing the whole suite
  //    there keeps the policy uniform.
  //
  // EC-7 DOCUMENT: any new test must be process-isolation-tolerant
  // (no shared in-process state, no module cache observation, no
  // thread-only vitest mocks). Per-file subprocesses avoid the HOME race,
  // but cross-file pollution inside ONE file's process can still happen if
  // a test mutates module state without resetting it in its own afterEach.
  pool: "forks" as const,
  // B-104, MEASURED 2026-08-19: the `poolOptions.forks.{singleFork,minForks,
  // maxForks}` block that used to live here is 100% dead in Vitest 4. Two
  // independent facts, both confirmed by reading node_modules/vitest/dist:
  //
  // 1. `"poolOptions" in resolved` only triggers the DEPRECATED log
  //    ("`test.poolOptions` was removed in Vitest 4. All previous
  //    `poolOptions` are now top-level options.") — nothing reads the keys
  //    inside it. `singleFork`/`minForks`/`maxForks` do not exist ANYWHERE
  //    in the v4 dist (grepped, zero matches outside type comments); they
  //    were renamed, not merely relocated.
  // 2. Their top-level replacements are `isolate` (subprocess-per-file vs.
  //    shared subprocess — the `singleFork` axis) and `maxWorkers`/
  //    `minWorkers` (the `*Forks` axis). At the time of this measurement,
  //    `fileParallelism: false` below forced `resolved.maxWorkers = 1`
  //    UNCONDITIONALLY (vitest ignores any configured `maxWorkers` when
  //    file parallelism is off) — so even migrated to top level, a
  //    fork-count knob could never have any effect while file parallelism
  //    stayed disabled. `SDK_TEST_MAX_FORKS` and its `MAX_FORKS` constant
  //    were deleted rather than migrated: keeping a documented env var that
  //    cannot act would be worse than having none. `fileParallelism` was
  //    flipped to `true` by B-059 (below); a `maxWorkers` knob would now be
  //    able to act, and one was reintroduced immediately after
  //    `fileParallelism` below — this time in the spelling Vitest 4 reads.
  //
  // What DOES still take effect, and is kept: `isolate: true` (Vitest 4's
  // default, made explicit here) is the direct replacement for the old
  // `singleFork: false` — each test file runs in its own fresh subprocess,
  // so `process.env.HOME` mutations in one file's `beforeEach` cannot race
  // another file's. This is what actually prevents the HOME race described
  // above — a fresh subprocess per file, not the file-level serialization
  // below — which is why flipping `fileParallelism` (see immediately below)
  // does not reopen it.
  isolate: true,
  // B-059, MEASURED 2026-08-20: this used to be `false`, with a comment
  // claiming file-level serialization was "load-bearing for the HOME-race
  // fix". It was never true isolation that required it — `isolate: true`
  // above already gives every file its own subprocess, so a HOME mutation
  // in one file's `beforeEach` cannot reach another file's regardless of
  // whether files run one-at-a-time or concurrently. The two HOME-mutating
  // leaks the old comment named were independently closed by B-120/B-117.
  //
  // Re-measured with those closed: `fileParallelism: true` alone (main
  // tree, twice, prior to this item) ran the full suite green. This item
  // then found a REAL race the strict-serial default was masking —
  // `tests/internal/memory/adapters/embedding-wire-contract.test.ts` kept a
  // file-level mutable `probeCounter` shared by concurrent `it()` bodies —
  // reproduced 3/3 under `fileParallelism: true` + `maxConcurrency` restored
  // + `sequence.shuffle: true` (see `vitest.shuffle.config.ts`). Fixed by
  // removing the shared counter (each call site now owns its own probe
  // text; no mutable state left to race). Re-measured after the fix, at the
  // harder setting (`maxConcurrency: 5` + shuffle): 3/3 clean on the main
  // tree (0 failures, deterministic across runs), on top of 5/5 clean runs
  // of the fixed file alone.
  //
  // That clears the bar for flipping this flag in the default gate. Files
  // now run in parallel, each still in its own subprocess (`isolate: true`
  // above), so cross-file mutable state must be genuinely absent — not
  // merely lucky under serial scheduling — for a file to pass here.
  fileParallelism: true,
  // The knob B-104 said could now act. With `fileParallelism: true` above,
  // vitest no longer forces `maxWorkers` to 1, so the default applies:
  // os.availableParallelism(), one fork per core. This repo's `test` script
  // is `turbo run test --filter='./packages/*'`, so that default is paid once
  // per package, concurrently — nproc forks times turbo's concurrency, on
  // nproc cores. Leaving 4 cores free costs no wall-clock; the parallelism
  // above this point was already noise when measured.
  maxWorkers: Math.max(2, cpus().length - 4),
  // Hard cap on test concurrency WITHIN a file. Kept at 1 even though
  // `fileParallelism` is now `true` above: the measurement that justifies
  // this file's default gate is the twice-validated `fileParallelism: true`
  // + `maxConcurrency: 1` combination, not the harder `maxConcurrency: 5` +
  // `sequence.shuffle: true` combination `vitest.shuffle.config.ts` runs as
  // a separate, periodic, non-blocking probe (see that file's own
  // doc-comment). Raising this here would fold the shuffle probe's job into
  // the push/PR gate, which is deliberately not this file's job.
  maxConcurrency: 1,
};

// Default `pnpm test` runs everything under `tests/` EXCEPT `ROADMAP_ONLY_SUITES`.
// Run those explicitly with `pnpm test:roadmap`, which is declared in the ROOT
// package.json and therefore has to be invoked from the repository root; the
// in-package equivalent is `npx vitest run --config vitest.roadmap.config.ts`.
//
// The previous version of this note sent the reader to `.claude/quality-gates.md G4`
// for the contract. No file of that name exists anywhere in the repository — the
// pointer was dead. The contract is the ROADMAP_ONLY_SUITES doc-comment above.
export default defineConfig({
  test: {
    ...SHARED_TEST_OPTIONS,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...ROADMAP_ONLY_SUITES],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/**"],
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/**/types.ts",
        // `include: ["src/**"]` also matches the prose README.md files that sit beside
        // the code. The v8 provider hands each one to rollup, which fails with
        // `RollupError: Expected ident` and prints a stack trace per file on every
        // coverage run. Excluding them removes that noise; they were never counted.
        "src/**/*.md",
      ],
      // `src/internal/telemetry/adapters/**` used to be excluded here, with the
      // justification that the adapters "safe-require" optional peer-deps (Langfuse,
      // Sentry, PostHog) so "their bodies cannot run under the regular test suite".
      //
      // That stopped being true on 2026-08-19: commit de2f9691 added
      // tests/telemetry/{langfuse,posthog,sentry}-adapter.test.ts, and all seven
      // adapters now have a test file. MEASURED with the exclusion removed: the seven
      // files carry 98 lines / 82 branches at 91.84% lines and 85.37% branches —
      // ABOVE the package average, so the exclusion was hiding coverage that exists.
      // Its numeric effect was small (branches 78.30% → 78.36%); the reason it had to
      // go is that the comment asserting the code was untestable had become false.
      thresholds: {
        // MEASURED 2026-08-19, three green runs of this exact configuration
        // (685 files / 4866 cases, `vitest run --coverage`), cross-checked against the
        // DA:/BRDA:/FNDA: counters in coverage/lcov.info rather than read off the table:
        //
        //   run   statements   branches    functions   lines
        //   1     86.54%       78.36%      88.60%      88.19%
        //   2     86.59%       78.38%      88.70%      88.23%
        //   3     86.70%       78.59%      88.80%      88.33%
        //
        // The same tree therefore measures over a 0.14–0.23 point range depending on the
        // run, so a floor is only useful if it sits below the LOWEST value by more than
        // that spread — otherwise it reports scheduling noise as a coverage regression.
        // These floors clear the lowest observation by 0.54 / 0.36 / 0.60 / 1.19 points.
        //
        // The previous floors were 80/80/75/80 and were enforced by nothing. They were
        // also stale: an audit on 2026-08-18 recorded branches at 74.72%, below the
        // declared 75. Re-measured on 2026-08-19 the same command reports 77.98% on the
        // old config and 78.36–78.59% on this one — a day of shipped test work closed
        // the gap, so nothing had to be lowered to make the gate pass.
        //
        // Ratchet upward as coverage improves. Lowering one is allowed only with the
        // date, the measured number and the reason recorded right here.
        lines: 87,
        functions: 88,
        branches: 78,
        statements: 86,
      },
    },
  },
});
