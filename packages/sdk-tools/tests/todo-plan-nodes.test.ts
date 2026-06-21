import { describe, expect, it } from "vitest";

import { createTodolistTool as createFromBarrel, todoItemsToPlanNodes } from "../src/index.js";
import { todoItemsToPlanNodes as adapter } from "../src/todo-plan-nodes.js";
import type { TodoItem } from "../src/todolist.js";

function item(over: Partial<TodoItem>): TodoItem {
  return { id: "todo-1", title: "t", status: "pending", createdAt: 0, ...over };
}

describe("todoItemsToPlanNodes (M4-5)", () => {
  it("maps id, label (=title), status", () => {
    expect(adapter([item({ id: "todo-9", title: "Ship it", status: "done" })])).toEqual([
      { id: "todo-9", label: "Ship it", status: "done" },
    ]);
  });

  it("empty input returns empty", () => {
    expect(adapter([])).toEqual([]);
  });

  it("preserves status and order across all three states", () => {
    const nodes = adapter([
      item({ id: "a", status: "pending" }),
      item({ id: "b", status: "in_progress" }),
      item({ id: "c", status: "done" }),
    ]);
    expect(nodes.map((n) => `${n.id}:${n.status}`)).toEqual([
      "a:pending",
      "b:in_progress",
      "c:done",
    ]);
  });

  it("(EC-1) projects exactly {id, label, status} — no timestamp leak", () => {
    const [node] = adapter([item({ completedAt: 123, createdAt: 456 })]);
    expect(Object.keys(node as object).sort()).toEqual(["id", "label", "status"]);
  });

  it("(wiring) tool result.items feeds the adapter via the barrel", () => {
    const tool = createFromBarrel();
    const result = JSON.parse(tool.handler({ action: "add", title: "via barrel" }));
    const nodes = todoItemsToPlanNodes(result.items);
    expect(nodes).toEqual([{ id: result.items[0].id, label: "via barrel", status: "pending" }]);
  });
});
