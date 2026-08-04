/**
 * M76 review (H1) — o guard de segredo por segmento, testado DIRETAMENTE.
 *
 * ## Why this file exists
 *
 * Mutation review proved 3 of the 4 decision branches had no oracle. Reducing
 * `SEGMENTOS_SENSIVEIS` a `{".env"}` — deixando `.git`, `node_modules` e `.theo` passarem —, inverter
 * the `.env.example` exception, or removing the regex `/^\.env\./` (which catches `.env.production`), **passed
 * with the whole suite green**. Only the literal `.env` was covered, and by accident: through a test of
 * `list-dir` that exercised a path with that segment.
 *
 * The guard is `allowAbsolute`'s non-negotiable half: `isForbiddenPath` only blocks the sensitive item
 * when it is the FIRST segment, so a `/home/u/proj/.env/sub` would pass. Testing it only
 * indirectly, through a tool, is what let 3 branches go unproven.
 *
 * ## On top of that, it had TWO copies
 *
 * M76's "promotion" moved the guard into `path-scope.ts` but left the private copy in
 * `read-file.ts` — creating exactly the duplication the promoted docblock said it existed to
 * avoid. Now there is only one, and this file is its oracle.
 */
import { describe, expect, it } from "vitest";

import { ehProibidoEmQualquerProfundidade } from "../src/path-scope.js";

describe("M76 review — guard de segredo por qualquer segmento", () => {
  it("test_it_blocks_each_sensitive_segment_at_depth", () => {
    // The branch the "reduce the list to {.env}" mutation broke without anything noticing.
    for (const seg of [".env", ".git", "node_modules", ".theo"]) {
      expect(
        ehProibidoEmQualquerProfundidade(`/home/u/proj/${seg}/sub/x`),
        `"${seg}" in an intermediate segment must block`,
      ).toBe(true);
    }
  });

  it("test_bloqueia_variantes_de_env_como_env_production", () => {
    // The `/^\.env\./` regex branch. Without it, `.env.production` — which carries production secrets —
    // would pass, while `.env` blocks. The worst failure mode: partial and plausible.
    for (const seg of [".env.production", ".env.local", ".env.staging"]) {
      expect(ehProibidoEmQualquerProfundidade(`/a/${seg}/b`), `"${seg}" tem de bloquear`).toBe(
        true,
      );
    }
  });

  it("test_env_example_e_a_EXCECAO_e_continua_liberado", () => {
    // The exception branch. `.env.example` is a versioned template — blocking it would be a false positive, and
    // a false positive here teaches the user to turn the guard off.
    expect(ehProibidoEmQualquerProfundidade("/a/.env.example/b")).toBe(false);
    expect(ehProibidoEmQualquerProfundidade("/a/.env.example")).toBe(false);
  });

  it("test_a_clean_path_does_NOT_block", () => {
    // COUNTER-PROOF: without it, an implementation always returning `true` would pass everything above.
    expect(ehProibidoEmQualquerProfundidade("/home/u/proj/src/lib")).toBe(false);
    expect(ehProibidoEmQualquerProfundidade("/usr/share/doc")).toBe(false);
  });

  it("test_the_windows_separator_is_analyzed_too", () => {
    // The guard's `replace(/\\/g, "/")`. Without it, a backslash path would escape entirely.
    expect(ehProibidoEmQualquerProfundidade("C:\\proj\\.git\\config")).toBe(true);
  });
});
