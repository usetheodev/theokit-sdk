/**
 * Filesystem — a boundary-enforced storage backend for agent file tools. Deterministic (no LLM):
 * every path resolves within `basePath`; traversal escapes are rejected with a typed security error.
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LocalFilesystem, FilesystemSecurityError } from "@theokit/sdk/filesystem";

const here = dirname(fileURLToPath(import.meta.url));

// Start from a clean boundary root so the example is self-contained and deterministic.
const root = join(here, "root");
mkdirSync(root, { recursive: true });
const fs = new LocalFilesystem({ basePath: root });

const stat = await fs.writeFile("notes.txt", "ship it");
console.log("wrote notes.txt, size:", stat.size);

console.log("readFile:", await fs.readFile("notes.txt"));
console.log("list:    ", (await fs.list(".")).sort().join(", "));

try {
  await fs.readFile("../secrets.txt");       // escape the boundary
} catch (err) {
  console.log("traversal blocked:", err instanceof FilesystemSecurityError);
}
