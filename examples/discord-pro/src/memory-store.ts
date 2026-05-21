import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Direct reader for `.theokit/memory/MEMORY.md` — lets `/me` list the user's
 * remembered facts without a LLM round-trip.
 *
 * @internal to the example
 */

const FACTS_HEADING = "## Facts";

export interface Fact {
  index: number;
  text: string;
}

export async function listFacts(cwd: string): Promise<Fact[]> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, ".theokit", "memory", "MEMORY.md"), "utf8");
  } catch {
    return [];
  }
  const idx = raw.indexOf(FACTS_HEADING);
  if (idx === -1) return [];
  const tail = raw.slice(idx + FACTS_HEADING.length);
  const out: Fact[] = [];
  let i = 0;
  for (const line of tail.split("\n")) {
    const match = line.match(/^- (.+)$/);
    if (match !== null) {
      i += 1;
      out.push({ index: i, text: match[1] ?? "" });
    } else if (line.startsWith("## ")) {
      break;
    }
  }
  return out;
}
