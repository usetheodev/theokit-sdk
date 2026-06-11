/**
 * `task` — delegate a focused sub-task to a child agent.
 *
 * Inspired by a peer project's task.ts — launches a child agent with its own context
 * that can use the same tools. The child runs the task and returns a summary.
 *
 * This enables the "ultrathink" pattern: the main agent breaks work into
 * sub-tasks and delegates each to a focused child agent.
 */

import type { Agent } from "@theokit/sdk";

export interface TaskResult {
  taskId: string;
  prompt: string;
  status: "completed" | "error";
  result: string;
  durationMs: number;
}

export interface TaskAgentTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: { prompt: string; context?: string }) => Promise<string>;
  /** Expose task history for testing. */
  getHistory: () => TaskResult[];
}

export interface TaskAgentOptions {
  /** The parent agent instance (used to create child sends). */
  agent: Agent;
  /** Maximum concurrent tasks (default: 1 — sequential). */
  maxConcurrent?: number;
  /** Timeout per task in ms (default: 120000 — 2 min). */
  timeoutMs?: number;
}

let taskCounter = 0;

export function createTaskAgentTool(options: TaskAgentOptions): TaskAgentTool {
  const { agent, timeoutMs = 120_000 } = options;
  const history: TaskResult[] = [];

  return {
    name: "task",
    description:
      "Delegate a focused sub-task to a child agent. " +
      "The child has access to the same tools and can read/write/edit files. " +
      "Use this for: (1) exploring a part of the codebase in depth, " +
      "(2) implementing a specific change from your plan, " +
      "(3) running tests and reporting results. " +
      "Provide a clear, specific prompt. Optionally include context from your plan.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description:
            "Clear, specific instruction for the sub-task. Include file paths and expected output.",
        },
        context: {
          type: "string",
          description:
            "Optional context from the current plan or conversation to pass to the child agent.",
        },
      },
      required: ["prompt"],
    },
    handler: async (input: { prompt: string; context?: string }): Promise<string> => {
      const taskId = `task-${++taskCounter}`;
      const fullPrompt = input.context
        ? `Context from parent agent:\n${input.context}\n\nTask:\n${input.prompt}`
        : input.prompt;

      const start = Date.now();

      try {
        const run = await agent.send(fullPrompt);

        // Race between task completion and timeout
        const result = await Promise.race([
          run.wait(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Task ${taskId} timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
        ]);

        const durationMs = Date.now() - start;
        const text = result.result ?? "(no response from child agent)";

        const taskResult: TaskResult = {
          taskId,
          prompt: input.prompt,
          status: "completed",
          result: text,
          durationMs,
        };
        history.push(taskResult);

        return JSON.stringify({
          ok: true,
          taskId,
          result: text,
          durationMs,
        });
      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);

        const taskResult: TaskResult = {
          taskId,
          prompt: input.prompt,
          status: "error",
          result: msg,
          durationMs,
        };
        history.push(taskResult);

        return JSON.stringify({
          ok: false,
          taskId,
          error: msg,
          durationMs,
        });
      }
    },
    getHistory: () => [...history],
  };
}
