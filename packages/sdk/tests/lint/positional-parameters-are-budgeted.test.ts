import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { expectScopeCovered } from "./_scope-sentinel.js";

/**
 * More than four positional parameters is a transposition hazard, and the ceiling is CONSENSUS —
 * Robert C. Martin, Clean Code ch. 3: three is already "questionable", more than three "requires
 * very special justification". Not a folklore number.
 *
 * The hazard is not aesthetic. Measured in this package before the audit that produced this file:
 * `runHandlerTool` was called as `("memory", handler, call, undefined, context, undefined, threadId)`
 * — two `undefined` placeholders three slots apart, one an `AbortSignal` and one a transcript
 * projection, both passed as a literal `undefined`. Swapping them compiled and silently disabled
 * either tool cancellation or the transcript. `buildRunToolCatalogInput` took eight, five of them
 * optional-or-nullable in adjacent slots, and its two test call sites were four bare `undefined` in
 * a row.
 *
 * The fix is never "fewer things" — it is one named record, which is what the call site usually
 * already held. `buildRunToolCatalogInput`'s eight arguments were eight fields of the SAME
 * `CreateRealLocalRunOptions` value, destructured at the call and re-assembled by position.
 *
 * 47 functions were over the ceiling when this was first measured. This budget pins what is left and
 * asks to be re-pinned downward — the shape `tools/check-duplication.mjs` and the sibling complexity
 * budget already use in this repo.
 *
 * WHAT THIS DOES NOT CHECK:
 *
 *   - Whether a 4-parameter function is FINE. Four adjacent `string`s transpose exactly as silently
 *     as six; the ceiling catches a correlate of the hazard, not the hazard.
 *   - Whether an options object was the right cure. `(ctx, step)` where `ctx` is a bag of unrelated
 *     values is the same function with the parameters hidden — and a reader can no longer see them.
 */
const SRC_ROOT = join(import.meta.dirname, "..", "..", "src");

/**
 * Re-pinned from 47 by the audit remediation: the eval runner's two strategies, the tool-catalog
 * builder, the tool-executor handler path, `LocalAgent.dispatchRun`, the seven-step tool dispatch,
 * the system-prompt assembly pair, and all nine workflow step runners took a named record each.
 */
const MAX_OVER_CEILING = 25;
const CEILING = 4;

/**
 * Anything a caller passes positional arguments to. Its own function, because folding the five
 * predicates into the visitor put THIS file at cognitive complexity 11 against the repo's max of
 * 10 — and a gate about excessive parameter lists that suppresses the complexity rule to exist
 * would be arguing against its own sibling budget.
 */
function isCallableDeclaration(node: ts.Node): node is ts.SignatureDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** How the node is named in the report: a declared name, `constructor`, or an anonymous callback. */
function declarationName(node: ts.SignatureDeclaration): string {
  if (node.name !== undefined) return node.name.getText();
  return ts.isConstructorDeclaration(node) ? "constructor" : "<anonymous>";
}

function overCeiling(file: string): string[] {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isCallableDeclaration(node)) {
      // `this` is a type annotation, not an argument anyone passes.
      const params = node.parameters.filter((p) => p.name.getText() !== "this");
      if (params.length > CEILING) {
        const where = relative(SRC_ROOT, file).split("\\").join("/");
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${where}:${line + 1} ${declarationName(node)} (${params.length})`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

describe("positional parameter lists are budgeted", () => {
  let offenders: string[] = [];
  let scanned: string[] = [];

  beforeAll(() => {
    scanned = walk(SRC_ROOT);
    offenders = scanned.flatMap(overCeiling);
  });

  it("reached the package entry point — a budget over an empty scan is not a pass", () => {
    expectScopeCovered(scanned, "index.ts", SRC_ROOT);
  });

  it(`no more than ${MAX_OVER_CEILING} functions exceed ${CEILING} positional parameters`, () => {
    expect(
      offenders.length,
      `${offenders.length} functions take more than ${CEILING} positional parameters, against a ` +
        `pinned ${MAX_OVER_CEILING}. If the count DROPPED, re-pin this number downward — that is how ` +
        "the budget ratchets. If it ROSE, the new function takes ONE named record instead: the " +
        "call site almost always holds that record already.\n\n" +
        offenders.join("\n"),
    ).toBeLessThanOrEqual(MAX_OVER_CEILING);
  });
});
