import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * List the `.md` files directly under `dir`, each as `{ absolutePath, relPath }` relative to `root`.
 *
 * One piece of knowledge — "list the markdown under a corpus subdirectory, treat a missing directory
 * as empty, and express each path relative to the memory root" — that existed three times:
 * `wiki-loader.discoverWikiFiles`, `session-loader.discoverSessionFiles`, and
 * `index-manager-helpers.markdownFilesIn`. A fix to one (an extension filter, a symlink guard, a sort
 * order) reached one corpus source and not the others.
 *
 * The three did not agree, and the disagreement is why this uses `relative()`. Two of them
 * hand-rolled the relative path by slicing `${root}/` off the front, which returns the ABSOLUTE path
 * unchanged for anything not under root and is wrong on any platform whose separator is not `/`. The
 * third already used `node:path`'s `relative`, which is correct in both cases; unifying on the
 * hand-rolled version would have spread the bug rather than removed it.
 *
 * A missing directory yields `[]` rather than throwing: every caller creates its corpus lazily, so
 * absence means "nothing indexed yet", not a fault. Any OTHER read failure propagates — a permissions
 * error is not an empty corpus, and reporting it as one is how an index silently goes stale.
 *
 * @internal
 */
export async function listMarkdownIn(
  dir: string,
  root: string,
  options: { readonly skip?: readonly string[] } = {},
): Promise<Array<{ absolutePath: string; relPath: string }>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const skip = options.skip ?? [];
  return entries
    .filter((entry) => entry.endsWith(".md") && !skip.includes(entry))
    .map((entry) => {
      const absolutePath = join(dir, entry);
      return { absolutePath, relPath: relative(root, absolutePath) };
    });
}
