/**
 * `todolist` — in-session task tracking for multi-step work.
 *
 * The agent uses this to plan complex tasks and track progress.
 * Inspired by a peer project's todo.ts and Claude Code's TodoWrite.
 *
 * Actions:
 *   - add(title)         → add a new todo item
 *   - complete(id)       → mark an item done
 *   - remove(id)         → remove an item
 *   - list()             → show all items with status
 *   - clear_completed()  → remove all done items
 */

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
  createdAt: number;
  completedAt?: number;
}

export interface TodolistTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: TodoInput) => string;
  /** Expose items for testing. */
  getItems: () => TodoItem[];
}

type TodoInput =
  | { action: "add"; title: string }
  | { action: "complete"; id: string }
  | { action: "in_progress"; id: string }
  | { action: "remove"; id: string }
  | { action: "list" }
  | { action: "clear_completed" };

function ok(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...data });
}

function fail(data: Record<string, unknown>): string {
  return JSON.stringify({ ok: false, ...data });
}

function requireId(input: TodoInput): string | null {
  if (!("id" in input) || !input.id) return null;
  return input.id;
}

export function createTodolistTool(): TodolistTool {
  const items: TodoItem[] = [];
  let nextId = 1;

  function genId(): string {
    return `todo-${nextId++}`;
  }

  function findById(id: string): TodoItem | undefined {
    return items.find((i) => i.id === id);
  }

  function formatList(): string {
    if (items.length === 0) return "No tasks. Use action 'add' to create one.";
    const lines = items.map((item) => {
      const icon = item.status === "done" ? "[x]" : item.status === "in_progress" ? "[>]" : "[ ]";
      return `${icon} ${item.id}: ${item.title}`;
    });
    const pending = items.filter((i) => i.status === "pending").length;
    const inProg = items.filter((i) => i.status === "in_progress").length;
    const done = items.filter((i) => i.status === "done").length;
    lines.push(`\n${done}/${items.length} done | ${inProg} in progress | ${pending} pending`);
    return lines.join("\n");
  }

  function handleAdd(input: TodoInput): string {
    if (!("title" in input) || !input.title) return fail({ error: "missing_title" });
    const item: TodoItem = {
      id: genId(),
      title: input.title,
      status: "pending",
      createdAt: Date.now(),
    };
    items.push(item);
    return ok({ id: item.id, message: `Added: ${item.title}`, items_summary: formatList() });
  }

  function handleSetStatus(input: TodoInput, status: "in_progress" | "done"): string {
    const id = requireId(input);
    if (!id) return fail({ error: "missing_id" });
    const item = findById(id);
    if (!item) return fail({ error: "not_found", id });
    item.status = status;
    if (status === "done") item.completedAt = Date.now();
    const verb = status === "done" ? "Completed" : "Started";
    return ok({ message: `${verb}: ${item.title}`, items_summary: formatList() });
  }

  function handleRemove(input: TodoInput): string {
    const id = requireId(input);
    if (!id) return fail({ error: "missing_id" });
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return fail({ error: "not_found", id });
    const removed = items.splice(idx, 1)[0]!;
    return ok({ message: `Removed: ${removed.title}`, items_summary: formatList() });
  }

  function handleClearCompleted(): string {
    const before = items.length;
    const kept = items.filter((i) => i.status !== "done");
    items.length = 0;
    items.push(...kept);
    return ok({
      message: `Cleared ${before - items.length} completed items`,
      items_summary: formatList(),
    });
  }

  const actions: Record<string, (input: TodoInput) => string> = {
    add: handleAdd,
    in_progress: (input) => handleSetStatus(input, "in_progress"),
    complete: (input) => handleSetStatus(input, "done"),
    remove: handleRemove,
    list: () => ok({ items_summary: formatList() }),
    clear_completed: handleClearCompleted,
  };

  return {
    name: "todolist",
    description:
      "Track multi-step task progress. " +
      "Actions: 'add' (create task with title), 'complete' (mark done by id), " +
      "'in_progress' (mark started by id), 'remove' (delete by id), " +
      "'list' (show all), 'clear_completed' (remove done items). " +
      "Returns { ok, items_summary }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "complete", "in_progress", "remove", "list", "clear_completed"],
          description: "The action to perform.",
        },
        title: {
          type: "string",
          description: "Title for a new todo item (required for 'add').",
        },
        id: {
          type: "string",
          description: "ID of the todo item (required for 'complete', 'in_progress', 'remove').",
        },
      },
      required: ["action"],
    },
    handler: (input: TodoInput): string => {
      const action = actions[input.action];
      if (!action) return fail({ error: "invalid_action" });
      return action(input);
    },
    getItems: () => [...items],
  };
}
