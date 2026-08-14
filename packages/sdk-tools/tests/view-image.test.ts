import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolResultContentBlock } from "@theokit/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createViewImageTool } from "../src/view-image.js";

/**
 * `view_image` — the one built-in a consumer had to write from scratch (89 LOC).
 *
 * ## Why it belongs here
 *
 * Its shape — `handler` returning a structured result plus `toModelOutput` shaping it into an
 * `ImageBlock` — is the canonical multimodal tool shape the SDK already defines (SE17). Every product that wants an agent
 * to LOOK at a screenshot rewrites the same base64 + media-type + confinement logic, and the
 * confinement is the part that is easy to get wrong: an image reader that honours any path is a file
 * exfiltration primitive with a friendly name.
 *
 * ## What the tests are about
 *
 * Almost all of them are about the boundary, because that is where this tool can hurt. Reading a PNG
 * correctly is one test; refusing to read `/etc/passwd`, `../../secrets`, and `.env` is four.
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "view-image-"));
});
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * Invoke the tool and read the MODEL-facing result.
 *
 * Measured in the SDK's `define-tool.ts`: when a spec declares `toModelOutput`, the handler the
 * factory returns already yields the model-facing value, and the FULL object is routed to the app
 * channel through a resolver under `TOOL_SPLIT_RESOLVER`. So `tool.handler(...)` gives image blocks
 * on success and a JSON string on failure — there is no `tool.toModelOutput` to call.
 */
const modelOutput = async (tool: ReturnType<typeof createViewImageTool>, path: string) =>
  (await tool.handler({ path }, {} as never)) as string | ToolResultContentBlock[];

/** The failure envelope, which reaches the model as text. */
const failure = async (tool: ReturnType<typeof createViewImageTool>, path: string) =>
  JSON.parse((await modelOutput(tool, path)) as string) as Record<string, unknown>;

describe("view_image reads an image the agent may look at", () => {
  it("test_a_png_reaches_the_model_as_an_ImageBlock_it_can_actually_see", async () => {
    // The whole point of the tool. A JSON envelope would reach the model as TEXT — a base64 blob it
    // cannot look at.
    writeFileSync(join(projectRoot, "shot.png"), PNG_1PX);

    const out = await modelOutput(createViewImageTool({ projectRoot }), "shot.png");

    expect(out).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: PNG_1PX.toString("base64") },
      },
    ]);
  });

  it("test_the_media_type_comes_from_the_extension_for_each_supported_format", async () => {
    for (const [file, media] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.gif", "image/gif"],
      ["a.webp", "image/webp"],
    ] as const) {
      writeFileSync(join(projectRoot, file), PNG_1PX);
      const out = (await modelOutput(createViewImageTool({ projectRoot }), file)) as unknown as [
        { source: { media_type: string } },
      ];
      expect(out[0].source.media_type, file).toBe(media);
    }
  });

  it("test_an_unsupported_extension_is_REFUSED_rather_than_guessed", async () => {
    // Guessing a media type sends the model bytes labelled as something they are not. Providers
    // reject or mis-render that, and the failure surfaces far from here.
    writeFileSync(join(projectRoot, "notes.txt"), "hello");
    const result = await failure(createViewImageTool({ projectRoot }), "notes.txt");
    expect(result).toMatchObject({ ok: false, error: "unsupported_image_type" });
  });
});

describe("the boundary — an image reader that honours any path is an exfiltration primitive", () => {
  it("test_a_traversal_path_is_refused", async () => {
    const result = await failure(createViewImageTool({ projectRoot }), "../../etc/passwd");
    expect(result).toMatchObject({ ok: false, error: "path_traversal" });
  });

  it("test_an_absolute_path_outside_the_project_is_refused", async () => {
    const result = await failure(createViewImageTool({ projectRoot }), "/etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("test_a_sensitive_directory_is_refused_even_with_an_image_extension", async () => {
    // `.env/logo.png` is a real shape: the guard must be about the SEGMENT, not the extension.
    mkdirSync(join(projectRoot, ".env"), { recursive: true });
    writeFileSync(join(projectRoot, ".env", "logo.png"), PNG_1PX);
    const result = await failure(createViewImageTool({ projectRoot }), ".env/logo.png");
    expect(result.ok).toBe(false);
  });

  it("test_a_missing_file_reports_not_found_instead_of_throwing", async () => {
    const result = await failure(createViewImageTool({ projectRoot }), "nope.png");
    expect(result).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("size — a screenshot is not a context budget", () => {
  it("test_a_file_over_the_cap_is_refused_and_says_the_limit", async () => {
    // Base64 inflates by 4/3 and lands directly in the model's context. A 20 MB screenshot is not a
    // slow request, it is a failed turn — and the refusal must say the number so it is actionable.
    writeFileSync(join(projectRoot, "big.png"), Buffer.alloc(2048));
    const result = await failure(createViewImageTool({ projectRoot, maxBytes: 1024 }), "big.png");
    expect(result).toMatchObject({ ok: false, error: "image_too_large" });
    expect(String(result.limit_bytes)).toBe("1024");
  });

  it("test_a_file_at_exactly_the_cap_is_accepted", async () => {
    // The boundary, stated: off-by-one here rejects a file that fits.
    writeFileSync(join(projectRoot, "edge.png"), Buffer.alloc(1024));
    const out = await modelOutput(createViewImageTool({ projectRoot, maxBytes: 1024 }), "edge.png");
    expect(Array.isArray(out), "a file at exactly the cap must be shown, not refused").toBe(true);
  });
});

describe("the name and description are contracts", () => {
  it("test_the_name_defaults_and_can_be_overridden", () => {
    // Same reasoning as M76 on the other builtins: the name is the approval key, what the model sees
    // and what telemetry records. A product whose agent calls it `look_at_image` must be able to say so.
    expect(createViewImageTool({ projectRoot }).name).toBe("view_image");
    expect(createViewImageTool({ projectRoot, name: "look" }).name).toBe("look");
  });
});
