import { expect, it } from "vitest";
import { InvalidAgentError } from "../src/agent-resolver.js";
import * as pkg from "../src/index.js";

/*
 * #369 — `serveAcp` has exactly one startup failure mode and its class was not exported.
 *
 * A consumer could neither `import` nor `instanceof` it, leaving `err.name` string-matching as the
 * only way to tell "you passed a bad agent" from any other rejection. The asymmetry was the
 * evidence: `PromptTooLargeError` IS exported, with a docblock saying it is exported "so that text
 * has a named origin". Both errors have the same justification.
 */

it("exports InvalidAgentError from the package entry", () => {
  expect(pkg.InvalidAgentError).toBe(InvalidAgentError);
});

it("is what serveAcp rejects with for a bad agent", async () => {
  await expect(pkg.serveAcp({ agent: 42 as never })).rejects.toBeInstanceOf(pkg.InvalidAgentError);
});

it("keeps the rest of the public surface intact", () => {
  // The accepted case (`testing.md` § 4.2). A barrel that re-exported everything internal would
  // satisfy both tests above while turning private machinery into semver contract.
  expect(Object.keys(pkg).sort()).toEqual(["InvalidAgentError", "PromptTooLargeError", "serveAcp"]);
});
