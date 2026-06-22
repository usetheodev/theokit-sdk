/**
 * `PermissionEngine` — first-match permission rules for tool invocations.
 *
 * Evaluates a tool name against an ordered list of rules. First matching rule
 * wins; when no rule matches the `defaultAction` is returned (M7-4 — default
 * `"allow"`, opt into default-deny via `{ defaultAction: "deny" }`).
 */

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
  /** Tool name (exact string) or pattern (RegExp). */
  tool: string | RegExp;
  /** Action to take when rule matches. */
  action: PermissionAction;
}

/** Options for {@link PermissionEngine}. */
export interface PermissionEngineOptions {
  /** Action when no rule matches. Default `"allow"` (backward-compatible). M7-4. */
  defaultAction?: PermissionAction;
}

export class PermissionEngine {
  private readonly defaultAction: PermissionAction;

  constructor(
    private readonly rules: PermissionRule[],
    options: PermissionEngineOptions = {},
  ) {
    this.defaultAction = options.defaultAction ?? "allow";
  }

  /**
   * Evaluate a tool name against the rules. First match wins; falls back to the
   * configured `defaultAction` (default `"allow"`) when no rule matches.
   */
  evaluate(toolName: string): PermissionAction {
    for (const rule of this.rules) {
      const matches =
        typeof rule.tool === "string" ? rule.tool === toolName : rule.tool.test(toolName);
      if (matches) return rule.action;
    }
    return this.defaultAction;
  }
}
