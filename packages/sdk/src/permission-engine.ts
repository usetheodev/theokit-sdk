/**
 * `PermissionEngine` — first-match permission rules for tool invocations.
 *
 * Evaluates a tool name (and optional arguments, #55) against an ordered list
 * of rules. First matching rule wins; when no rule matches the `defaultAction`
 * is returned. #55 — the default is now `"ask"` (FAIL-CLOSED): a permission
 * engine that cannot positively allow must not silently allow. Opt back into
 * the previous fail-open behavior with `{ defaultAction: "allow" }`.
 */

export type PermissionAction = "allow" | "deny" | "ask";

/**
 * SE1 — a per-run permission MODE that adjusts the rule-engine verdict globally.
 * A PURE post-processor of the verdict (no tool-safety metadata needed, so it fits
 * a bring-your-own-tools runtime). Grounded in a peer project (plan agent = deny-all,
 * `dangerously-skip-permissions`) + Codex (`AskForApproval`: `OnRequest` default,
 * `Never`, `UnlessTrusted`). See {@link applyMode} for the exact table.
 *
 * - `default` — verdict as-is (rules decide; unmatched ⇒ `ask`, fail-closed).
 * - `plan` — read-only: `allow` rules pass, everything else ⇒ `deny` (mutations blocked).
 *   NOTE: `plan` gates on the resolved verdict, so an engine configured with
 *   `{ defaultAction: "allow" }` still yields `allow` for UNMATCHED calls under
 *   `plan` — pair `plan` with the default fail-closed engine (`defaultAction: "ask"`)
 *   for full read-only behavior.
 * - `acceptEdits` — auto-approve the UNMATCHED verdict, but STILL honor an explicit
 *   `ask` rule (a caller gates a risky tool with an ask rule). Codex `UnlessTrusted`.
 * - `bypass` — everything ⇒ `allow` EXCEPT an explicit `deny` rule. Never asks.
 *   a peer project `dangerously-skip-permissions` / Codex `Never`.
 */
export type PermissionMode = "default" | "plan" | "acceptEdits" | "bypass";

/**
 * SE1 — apply a {@link PermissionMode} to a rule-engine verdict. Pure.
 *
 * `explicit` is `true` when the verdict came from a rule that matched by name (and
 * args), `false` when it is the fail-closed default for an unmatched call. The flag
 * is load-bearing for `acceptEdits`, which auto-approves the unmatched default but
 * keeps honoring an explicit `ask` rule (unlike `bypass`, which allows even that).
 *
 * INVARIANT (both a peer project + Codex): an explicit `deny` is immune to EVERY
 * auto-approve mode — `bypass`/`acceptEdits` never un-deny.
 */
export function applyMode(
  verdict: PermissionAction,
  mode: PermissionMode,
  explicit: boolean,
): PermissionAction {
  // (a) explicit deny is terminal under every mode — fail-closed.
  if (verdict === "deny") return "deny";
  switch (mode) {
    case "default":
      return verdict;
    case "plan":
      // read-only: only allow rules pass; ask + unmatched ⇒ deny.
      return verdict === "allow" ? "allow" : "deny";
    case "acceptEdits":
      // (b) auto-approve the unmatched default; honor an explicit ask rule.
      if (verdict === "ask") return explicit ? "ask" : "allow";
      return verdict; // allow stays allow
    case "bypass":
      // everything that survived the deny check ⇒ allow (never asks).
      return "allow";
  }
}

/**
 * #55 — an argument matcher. A rule with `args` gates on the tool's argument
 * VALUES, not just its name: an exact string, a RegExp (tested against the
 * stringified value), or a predicate. Every declared arg must match for the
 * rule to apply — so `{ tool: "shell", args: { command: /rm\s+-rf/ } }` denies
 * a destructive shell call while leaving `ls` to fall through.
 */
export type ArgMatcher = string | RegExp | ((value: unknown) => boolean);

export interface PermissionRule {
  /** Tool name (exact string) or pattern (RegExp). */
  tool: string | RegExp;
  /**
   * #55 — optional per-argument matchers. When present, the rule matches only
   * if the tool name matches AND every declared arg predicate matches the
   * corresponding call argument. A missing/undefined arg fails its predicate
   * (the rule does not match) — never throws.
   */
  args?: Record<string, ArgMatcher>;
  /** Action to take when rule matches. */
  action: PermissionAction;
}

/** Options for {@link PermissionEngine}. */
export interface PermissionEngineOptions {
  /**
   * Action when no rule matches. #55 — default is now `"ask"` (fail-closed): a
   * permission engine that cannot positively allow must not silently allow.
   * Pass `"allow"` to restore the previous fail-open behavior.
   */
  readonly defaultAction?: PermissionAction;
}

function argMatches(matcher: ArgMatcher, value: unknown): boolean {
  if (typeof matcher === "function") return matcher(value);
  if (value === undefined) return false; // missing arg never matches a declared predicate
  if (matcher instanceof RegExp) return matcher.test(String(value));
  return matcher === value;
}

export class PermissionEngine {
  private readonly defaultAction: PermissionAction;

  constructor(
    private readonly rules: PermissionRule[],
    options: PermissionEngineOptions = {},
  ) {
    // #55 — fail-closed by default.
    this.defaultAction = options.defaultAction ?? "ask";
  }

  /**
   * Evaluate a tool name (and optional arguments) against the rules. First
   * match wins; falls back to the configured `defaultAction` (default `"ask"`,
   * fail-closed) when no rule matches. #55 — a rule with `args` gates on the
   * argument values, so the same tool name can resolve to different actions
   * depending on what it is asked to do.
   */
  evaluate(
    toolName: string,
    args?: Record<string, unknown>,
    mode: PermissionMode = "default",
  ): PermissionAction {
    for (const rule of this.rules) {
      const nameMatches =
        typeof rule.tool === "string" ? rule.tool === toolName : rule.tool.test(toolName);
      if (!nameMatches) continue;
      if (rule.args !== undefined && !this.#argsMatch(rule.args, args)) continue;
      // SE1 — a matched rule is an EXPLICIT verdict; apply the mode with explicit=true.
      return applyMode(rule.action, mode, true);
    }
    // SE1 — no rule matched: the default is NOT explicit (explicit=false), so
    // `acceptEdits` auto-approves it while still honoring explicit `ask` rules above.
    return applyMode(this.defaultAction, mode, false);
  }

  #argsMatch(
    matchers: Record<string, ArgMatcher>,
    args: Record<string, unknown> | undefined,
  ): boolean {
    const call = args ?? {};
    for (const [key, matcher] of Object.entries(matchers)) {
      if (!argMatches(matcher, call[key])) return false;
    }
    return true;
  }
}
