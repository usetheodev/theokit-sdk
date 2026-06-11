import { type Agent, defineTool } from "@theokit/sdk";
import { Cache } from "@theokit/sdk-cache";
import { createListDirTool, createReadFileTool } from "@theokit/sdk-tools";

const a: Agent = null as never;
const c = Cache.semantic({} as never);
const r = createReadFileTool({ cwd: "" });
const l = createListDirTool({ cwd: "" });

export { a, c, defineTool, l, r };
