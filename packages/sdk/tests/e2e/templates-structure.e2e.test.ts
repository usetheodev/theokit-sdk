import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES_DIR = join(__dirname, "../../templates");

const EXPECTED_TEMPLATES = [
  "chatbot",
  "rag-agent",
  "multi-agent",
  "workflow-automation",
  "telegram-bot",
];

describe("E2E: starter templates structure", () => {
  it("all 5 template directories exist", () => {
    const dirs = readdirSync(TEMPLATES_DIR).sort();
    expect(dirs).toEqual(EXPECTED_TEMPLATES.sort());
  });

  for (const name of EXPECTED_TEMPLATES) {
    describe(`template: ${name}`, () => {
      const dir = join(TEMPLATES_DIR, name);

      it("has package.json", () => {
        expect(existsSync(join(dir, "package.json"))).toEqual(true);
      });

      it("has tsconfig.json", () => {
        expect(existsSync(join(dir, "tsconfig.json"))).toEqual(true);
      });

      it("has src/index.ts", () => {
        expect(existsSync(join(dir, "src/index.ts"))).toEqual(true);
      });

      it("has README.md with content", () => {
        const readme = join(dir, "README.md");
        expect(existsSync(readme)).toEqual(true);
        const content = readFileSync(readme, "utf-8");
        expect(content.length).toBeGreaterThan(10);
      });

      it("src/index.ts is under 100 LoC", () => {
        const content = readFileSync(join(dir, "src/index.ts"), "utf-8");
        const lines = content.split("\n").length;
        expect(lines).toBeLessThan(100);
      });
    });
  }
});
