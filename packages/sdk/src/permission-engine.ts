/**
 * `PermissionEngine` — first-match permission rules for tool invocations.
 *
 * Evaluates a tool name against an ordered list of rules.
 * First matching rule wins; default is "allow" when no rule matches.
 */

export type PermissionAction = "allow" | "deny" | "ask";

export interface PermissionRule {
  /** Tool name (exact string) or pattern (RegExp). */
  tool: string | RegExp;
  /** Action to take when rule matches. */
  action: PermissionAction;
}

export class PermissionEngine {
  constructor(private readonly rules: PermissionRule[]) {}

  /**
   * Evaluate a tool name against the rules. First match wins; default "allow".
   */
  evaluate(toolName: string): PermissionAction {
    for (const rule of this.rules) {
      if (typeof rule.tool === "string") {
        if (rule.tool === toolName) return rule.action;
      } else {
        if (rule.tool.test(toolName)) return rule.action;
      }
    }
    return "allow";
  }
}
