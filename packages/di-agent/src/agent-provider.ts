import { type FactoryProvider, Scope } from "@theokit/di";

import { AGENT_TOKEN } from "./tokens.js";

/**
 * Options accepted by `createAgentProvider()`. Mirrors the public
 * `AgentOptions` from `@theokit/sdk` but kept structural so this package
 * does not have a hard import dependency on the SDK's type tree.
 *
 * The factory `async () => Agent.create(options)` is provided by the
 * consumer (see `createAgentProvider` below). This package supplies the
 * scope + token wiring.
 */
export interface CreateAgentProviderOptions<TAgent> {
  /**
   * Factory function that produces a fresh Agent per REQUEST.
   * Typically `() => Agent.create({...})` from `@theokit/sdk`.
   */
  factory: () => TAgent | Promise<TAgent>;
  /**
   * Override the scope. Default is `REQUEST` (the wedge — one isolated
   * Agent per HTTP request). Override to `SINGLETON` for CLI / cron /
   * single-tenant scenarios where a shared Agent is desirable.
   */
  scope?: Scope;
}

/**
 * Build a `FactoryProvider` that materializes an Agent on demand.
 *
 * @example
 *   import { Agent } from "@theokit/sdk";
 *   import { Module } from "@theokit/di";
 *   import { createAgentProvider } from "@theokit/di-agent";
 *
 *   @Module({
 *     providers: [
 *       createAgentProvider({
 *         factory: () => Agent.create({ apiKey: process.env.OPENROUTER_API_KEY!, model: { id: "openai/gpt-4o-mini" } }),
 *       }),
 *     ],
 *   })
 *   class AppModule {}
 */
export function createAgentProvider<TAgent>(
  options: CreateAgentProviderOptions<TAgent>,
): FactoryProvider<TAgent> {
  return {
    provide: AGENT_TOKEN,
    useFactory: () => options.factory(),
    scope: options.scope ?? Scope.REQUEST,
  };
}
