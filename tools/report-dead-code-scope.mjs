#!/usr/bin/env node
/**
 * B-134 — `knip` exits 0 and prints NOTHING on success, while the three gates beside it each report
 * what they examined: `depcruise` says "541 modules, 1196 dependencies cruised", `jscpd` prints its
 * counts and its budget, `biome` says "Checked 1701 files".
 *
 * That mattered here rather than being a cosmetic gap. Measured 2026-08-20: dropping the
 * `src/internal/**` ignore surfaces 269 findings (85 unused exports + 184 unused exported types), and
 * `src/internal/` holds 527 of this repository's source files. So `quality:dead` passing meant the
 * dead-code tool had looked at the public barrel and almost nothing else — and three dead-code items
 * found by hand this month (B-097, B-103, B-116) all live inside the ignored tree.
 *
 * A gate that does not look is indistinguishable from a gate that found nothing, unless it says which
 * it was. This prints the scope so the pass carries the information the sentence implies.
 *
 * It deliberately does NOT change the ignore. Whether that suppression should stay is a decision
 * recorded on B-134; this only stops it being invisible.
 */
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../knip.json", import.meta.url), "utf8"));
const declared = Object.keys(cfg.workspaces ?? {});
const ignored = Object.entries(cfg.workspaces ?? {}).flatMap(([ws, w]) =>
  (w.ignore ?? []).map((pattern) => `${ws}:${pattern}`),
);

console.log(
  `[knip] PASS — ${declared.length} workspace(s) declared: ${declared.join(", ") || "(none)"}`,
);
console.log(
  ignored.length === 0
    ? "[knip] no paths ignored"
    : `[knip] ${ignored.length} ignored path(s), NOT examined: ${ignored.join(", ")}`,
);
console.log(
  "[knip] measured 2026-08-20: dropping the src/internal/** ignore surfaces 85 unused exports " +
    "+ 184 unused exported types (269). That tree holds 527 of this repo's source files, so a pass " +
    "here examines the public barrel and little else.",
);
