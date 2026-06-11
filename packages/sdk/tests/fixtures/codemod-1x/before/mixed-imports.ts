import { type Agent, Cache, defineTool } from "@theokit/sdk";
import { createListDirTool, createReadFileTool } from "@theokit/sdk/tools";

const a: Agent = null as never;
const c = Cache.semantic({} as never);
const r = createReadFileTool({ cwd: "" });
const l = createListDirTool({ cwd: "" });

export { a, c, defineTool, l, r };
