import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `SendOptions` is the most frequently constructed type in the SDK — the argument of `agent.send()`,
 * of `agent.generate()` which extends it, and of every batch and workflow step that forwards it. It
 * carries 21 optional fields whose audiences do not overlap: a UI wants `onDelta`, a policy layer
 * wants `permissionMode`, an eval harness wants `maxIterations`. Nothing grouped them, so every
 * consumer read all 21 to find their two.
 *
 * The chosen fix was the docblock table rather than nesting the groups behind `observe?` /
 * `toolPolicy?` with deprecated flat aliases — the harm is the reading cost, and a migration would
 * have added surface in order to remove surface.
 *
 * A table drifts silently, and that is worse than no table: a reader trusts it and stops looking at
 * the type. This is what stops it.
 *
 * WHAT IT DOES NOT CHECK: whether a field is in the RIGHT row. `signal` sits with the harness group
 * and would sit equally well with the overrides; the gate would not notice. It checks coverage, which
 * is the property that decays.
 */
const RUN_TYPES = join(import.meta.dirname, "..", "..", "src", "types", "run.ts");

function sendOptionsSource(): string {
  const body = readFileSync(RUN_TYPES, "utf8");
  const start = body.indexOf("export interface SendOptions {");
  expect(start, "SendOptions was renamed or moved — this gate is aimed at nothing").toBeGreaterThan(
    -1,
  );
  let depth = 0;
  let i = start;
  for (; i < body.length; i += 1) {
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return body.slice(start, i + 1);
}

/** The docblock that precedes the interface — where the table lives. */
function docblockSource(): string {
  const body = readFileSync(RUN_TYPES, "utf8");
  const start = body.indexOf("export interface SendOptions {");
  const docStart = body.lastIndexOf("/**", start);
  return body.slice(docStart, start);
}

describe("the SendOptions audience table covers every field", () => {
  const fields = [...sendOptionsSource().matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1] as string);
  const table = docblockSource();

  it("found the fields — an empty scan would pass every assertion below", () => {
    expect(fields.length).toBeGreaterThan(15);
    expect(fields).toContain("onDelta");
  });

  it("names every field in exactly one row", () => {
    const missing = fields.filter((f) => !new RegExp(String.raw`\`${f}\``).test(table));
    expect(
      missing,
      "these SendOptions fields are in no row of the `## Which options do I need?` table. Add each " +
        "to the row whose audience would reach for it — see the table's own note on why it exists.",
    ).toEqual([]);

    const duplicated = fields.filter(
      (f) => (table.match(new RegExp(String.raw`\`${f}\``, "g")) ?? []).length > 1,
    );
    expect(
      duplicated,
      "these fields appear in more than one row; a field with two audiences makes the table a second " +
        "copy of the type rather than a way into it.",
    ).toEqual([]);
  });

  it("keeps the table itself — deleting it must not be the way to pass", () => {
    expect(table).toContain("## Which options do I need?");
    expect(table.split("\n").filter((l) => l.includes("|")).length).toBeGreaterThan(5);
  });
});
