import { beforeEach, describe, expect, it } from "vitest";
import { createTodolistTool } from "../../src/tools/todolist.js";

describe("createTodolistTool", () => {
  let tool: ReturnType<typeof createTodolistTool>;

  beforeEach(() => {
    tool = createTodolistTool();
  });

  it("starts with empty list", () => {
    const result = JSON.parse(tool.handler({ action: "list" }));
    expect(result.ok).toBe(true);
    expect(result.items_summary).toContain("No tasks");
  });

  it("adds a todo item", () => {
    const result = JSON.parse(tool.handler({ action: "add", title: "Fix the bug" }));
    expect(result.ok).toBe(true);
    expect(result.id).toMatch(/^todo-\d+$/);
    expect(result.items_summary).toContain("Fix the bug");
  });

  it("marks item in progress", () => {
    const added = JSON.parse(tool.handler({ action: "add", title: "Write tests" }));
    const result = JSON.parse(tool.handler({ action: "in_progress", id: added.id }));
    expect(result.ok).toBe(true);
    expect(result.items_summary).toContain("[>]");
    expect(result.items_summary).toContain("1 in progress");
  });

  it("completes a todo item", () => {
    const added = JSON.parse(tool.handler({ action: "add", title: "Deploy" }));
    const result = JSON.parse(tool.handler({ action: "complete", id: added.id }));
    expect(result.ok).toBe(true);
    expect(result.items_summary).toContain("[x]");
    expect(result.items_summary).toContain("1/1 done");
  });

  it("removes a todo item", () => {
    const added = JSON.parse(tool.handler({ action: "add", title: "Temporary" }));
    const result = JSON.parse(tool.handler({ action: "remove", id: added.id }));
    expect(result.ok).toBe(true);
    expect(result.items_summary).toContain("No tasks");
  });

  it("clears completed items", () => {
    const a1 = JSON.parse(tool.handler({ action: "add", title: "Done task" }));
    tool.handler({ action: "add", title: "Pending task" });
    tool.handler({ action: "complete", id: a1.id });
    const result = JSON.parse(tool.handler({ action: "clear_completed" }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Cleared 1");
    expect(tool.getItems()).toHaveLength(1);
    expect(tool.getItems()[0]!.title).toBe("Pending task");
  });

  it("rejects add without title", () => {
    const result = JSON.parse(tool.handler({ action: "add" } as never));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_title");
  });

  it("rejects complete with unknown id", () => {
    const result = JSON.parse(tool.handler({ action: "complete", id: "nope" }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_found");
  });

  it("rejects invalid action", () => {
    const result = JSON.parse(tool.handler({ action: "dance" } as never));
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_action");
  });

  it("tracks multiple items with correct counts", () => {
    const a1 = JSON.parse(tool.handler({ action: "add", title: "Task 1" }));
    const a2 = JSON.parse(tool.handler({ action: "add", title: "Task 2" }));
    tool.handler({ action: "add", title: "Task 3" });
    tool.handler({ action: "complete", id: a1.id });
    tool.handler({ action: "in_progress", id: a2.id });
    const result = JSON.parse(tool.handler({ action: "list" }));
    expect(result.items_summary).toContain("1/3 done");
    expect(result.items_summary).toContain("1 in progress");
    expect(result.items_summary).toContain("1 pending");
  });

  it("exposes items via getItems", () => {
    tool.handler({ action: "add", title: "Exposed" });
    const items = tool.getItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Exposed");
    expect(items[0]!.status).toBe("pending");
  });
});
