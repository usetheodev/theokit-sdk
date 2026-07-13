/**
 * Filesystem — a boundary-enforced storage backend for agent file tools. Deterministic (no LLM):
 * every path resolves within `basePath`; traversal escapes are rejected with a typed security error.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LocalFilesystem, FilesystemSecurityError } from "@theokit/sdk/filesystem";

const here = dirname(fileURLToPath(import.meta.url));
const fs = new LocalFilesystem({ basePath: join(here, "root") });

const stat = await fs.writeFile("notes.txt", "ship it");
console.log("wrote notes.txt, size:", stat.size);

console.log("readFile:", await fs.readFile("notes.txt"));
console.log("list:    ", (await fs.list(".")).sort().join(", "));

try {
  await fs.readFile("../run.ts");            // escape the boundary
} catch (err) {
  console.log("traversal blocked:", err instanceof FilesystemSecurityError);
}
