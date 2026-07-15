import { beforeEach, describe, expect, it } from "vitest";
import { createTodolistTool } from "../src/todolist.js";

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

  it("(M4-5 bug fix) add result includes the structured items array", () => {
    const result = JSON.parse(tool.handler({ action: "add", title: "Fix the bug" }));
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: "Fix the bug", status: "pending" });
    expect(result.items[0].id).toMatch(/^todo-\d+$/);
  });

  it("(M4-5) list result includes structured items reflecting all items", () => {
    tool.handler({ action: "add", title: "A" });
    tool.handler({ action: "add", title: "B" });
    const result = JSON.parse(tool.handler({ action: "list" }));
    expect(result.items.map((i: { title: string }) => i.title)).toEqual(["A", "B"]);
  });

  it("(M4-5) complete result items reflect the new status", () => {
    const added = JSON.parse(tool.handler({ action: "add", title: "Ship" }));
    const result = JSON.parse(tool.handler({ action: "complete", id: added.id }));
    expect(result.items[0].status).toBe("done");
  });

  it("(M4-5) remove and clear_completed results also carry structured items", () => {
    const a1 = JSON.parse(tool.handler({ action: "add", title: "keep" }));
    const a2 = JSON.parse(tool.handler({ action: "add", title: "drop" }));
    const removed = JSON.parse(tool.handler({ action: "remove", id: a2.id }));
    expect(removed.items.map((i: { title: string }) => i.title)).toEqual(["keep"]);
    tool.handler({ action: "complete", id: a1.id });
    const cleared = JSON.parse(tool.handler({ action: "clear_completed" }));
    expect(Array.isArray(cleared.items)).toBe(true);
    expect(cleared.items).toEqual([]);
  });

  it("(M4-5) a title with JSON-special chars round-trips through the result intact", () => {
    const tricky = 'She said "hi"\nand \\ {edge}';
    const result = JSON.parse(tool.handler({ action: "add", title: tricky }));
    expect(result.items[0].title).toBe(tricky);
  });

  it("(M4-5 EC-2) error results carry NO items field", () => {
    const missingTitle = JSON.parse(tool.handler({ action: "add" } as never));
    expect(missingTitle.ok).toBe(false);
    expect("items" in missingTitle).toBe(false);
    const notFound = JSON.parse(tool.handler({ action: "complete", id: "nope" }));
    expect("items" in notFound).toBe(false);
  });

  it("two instances have independent IDs (EC-1)", () => {
    const tool1 = createTodolistTool();
    const tool2 = createTodolistTool();
    const r1 = JSON.parse(tool1.handler({ action: "add", title: "A" }));
    const r2 = JSON.parse(tool2.handler({ action: "add", title: "B" }));
    expect(r1.id).toBe("todo-1");
    expect(r2.id).toBe("todo-1");
    expect(tool1.getItems()).toHaveLength(1);
    expect(tool2.getItems()).toHaveLength(1);
  });

  // #119 — a SINGLE tool object reused across sessions (the multi-tenant server shape:
  // one definition built at module load, served to many `Agent.getOrCreate(sessionId)`)
  // must NOT leak one session's list into another. State is keyed by `ctx.threadId`.
  it("#119: isolates state per ctx.threadId — no cross-session leak", () => {
    const shared = createTodolistTool();
    shared.handler({ action: "add", title: "A-private" }, { threadId: "sess-A" });

    // Session B lists first — it must see an EMPTY list, not A's private item.
    const bList = JSON.parse(shared.handler({ action: "list" }, { threadId: "sess-B" }));
    expect(bList.items).toHaveLength(0);

    // Session A still has exactly its own item.
    const aList = JSON.parse(shared.handler({ action: "list" }, { threadId: "sess-A" }));
    expect(aList.items).toHaveLength(1);
    expect(aList.items[0].title).toBe("A-private");

    // getItems() is likewise session-scoped.
    expect(shared.getItems("sess-A")).toHaveLength(1);
    expect(shared.getItems("sess-B")).toHaveLength(0);

    // IDs are independent per session (each session counts from todo-1).
    const bAdd = JSON.parse(
      shared.handler({ action: "add", title: "B-first" }, { threadId: "sess-B" }),
    );
    expect(bAdd.id).toBe("todo-1");
  });

  it("#119: absent threadId shares one default session (CLI back-compat)", () => {
    const tool = createTodolistTool();
    tool.handler({ action: "add", title: "cli-task" }); // no ctx — single-session CLI usage
    const list = JSON.parse(tool.handler({ action: "list" }));
    expect(list.items).toHaveLength(1);
    expect(tool.getItems()).toHaveLength(1);
  });
});
