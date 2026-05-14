import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface TempWorkspace {
  cwd: string;
  writeText(relativePath: string, contents: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createTempWorkspace(fixtureName?: string): Promise<TempWorkspace> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-sdk-contract-"));

  if (fixtureName) {
    const fixturePath = resolve(import.meta.dirname, "..", "fixtures", "repos", fixtureName);
    await cp(fixturePath, cwd, { recursive: true });
  }

  return {
    cwd,
    async writeText(relativePath, contents) {
      const target = join(cwd, relativePath);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, contents, "utf8");
    },
    async cleanup() {
      await rm(cwd, { recursive: true, force: true });
    },
  };
}
