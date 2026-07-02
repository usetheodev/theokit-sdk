/**
 * `PermissionEngine` — first-match permission rules for tool invocations.
 *
 * Evaluates a tool name against an ordered list of rules. First matching rule
 * wins; when no rule matches the `defaultAction` is returned (M7-4 — default
 * `"allow"`, opt into default-deny via `{ defaultAction: "deny" }`).
 */

export type PermissionAction = "allow" | "deny" | "ask";

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
  evaluate(toolName: string, args?: Record<string, unknown>): PermissionAction {
    for (const rule of this.rules) {
      const nameMatches =
        typeof rule.tool === "string" ? rule.tool === toolName : rule.tool.test(toolName);
      if (!nameMatches) continue;
      if (rule.args !== undefined && !this.#argsMatch(rule.args, args)) continue;
      return rule.action;
    }
    return this.defaultAction;
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
