/**
 * `view_image` — let the agent LOOK at an image in the project.
 *
 * ## Why this is a built-in
 *
 * It was the one tool a consumer had to write from scratch (89 LOC), and its shape — a `handler`
 * returning a structured result plus `toModelOutput` shaping it into an `ImageBlock` — is the
 * canonical multimodal shape the SDK already defines (SE17). Every product that wants an agent to look at a
 * screenshot rewrites the same base64 + media-type + confinement logic.
 *
 * The confinement is the part that is easy to get wrong, and the reason this belongs in a reviewed
 * built-in rather than in each product: **an image reader that honours any path is a file
 * exfiltration primitive with a friendly name.** `/etc/passwd` renamed to `.png` is not a
 * hypothetical — it is one prompt away.
 *
 * ## The two channels
 *
 * This built-in uses the SE17 split. The handler returns the envelope as a JSON **string** — which
 * is what `Tool.create` types it to return — and `toModelOutput` turns that string into an
 * `ImageBlock` for the model, while `defineTool` routes the full value to `onToolEnd` through a
 * resolver under `TOOL_SPLIT_RESOLVER`.
 *
 * So `tool.handler(...)` yields image blocks on success and the JSON string on failure: the factory
 * has already applied the shaping. There is no `tool.toModelOutput` left to call, and returning the
 * envelope unshaped would send the model a base64 blob as TEXT — something it cannot look at, which
 * is the failure this tool exists to avoid.
 *
 * ## Result shape (the APP channel)
 *
 *   - `{ ok: true, path, media_type, bytes, data }`
 *   - `{ ok: false, error: "path_traversal" | "not_found" | "unsupported_image_type" | "image_too_large", … }`
 */

import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { extname } from "node:path";

import type { CustomTool, ToolResultContentBlock } from "@theokit/sdk";
import { Tool } from "@theokit/sdk";
import { z } from "zod";

import { safePathJoin } from "./internal/path-guard.js";
import { checkPathScope, isForbiddenAtAnyDepth } from "./path-scope.js";

/**
 * Extensions the model can actually be shown, mapped to the media type providers accept.
 *
 * A closed table rather than a lookup library: guessing a media type sends the model bytes labelled
 * as something they are not, and the provider either rejects the turn or renders garbage — a failure
 * that surfaces far from here. An unknown extension is refused by name instead.
 */
const MEDIA_TYPES = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

/**
 * Default ceiling: 5 MB on disk.
 *
 * Base64 inflates by 4/3 and the result lands directly in the model's context. A 20 MB screenshot is
 * not a slow request — it is a failed turn, and an expensive one.
 */
export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Options for {@link createViewImageTool}. `maxBytes` is measured on disk, before base64 inflates the
 * payload by roughly a third on its way into the model's context — so the real context cost of a file
 * at the limit is about 6.7 MB of text, not 5 MB.
 */
export interface CreateViewImageToolOptions {
  /** Root the tool reads from. Every path is resolved inside it. */
  projectRoot: string;
  /** Name exposed to the model. Omitted ⇒ `view_image`. The name is a contract: it is the approval
   *  key, what the model sees, and what telemetry records. */
  name?: string;
  /** Description exposed to the model. Omitted ⇒ the literal below. */
  description?: string;
  /** Ceiling in bytes, measured on disk. Omitted ⇒ {@link DEFAULT_MAX_IMAGE_BYTES}. */
  maxBytes?: number;
}

interface ViewImageOk {
  ok: true;
  path: string;
  media_type: string;
  bytes: number;
  data: string;
}

interface ViewImageFailure {
  ok: false;
  error: "path_traversal" | "not_found" | "unsupported_image_type" | "image_too_large";
  path: string;
  [extra: string]: unknown;
}

type ViewImageResult = ViewImageOk | ViewImageFailure;

/**
 * The envelope, serialised.
 *
 * `Tool.create` types `handler` as returning a string, and that string is what reaches
 * `toModelOutput`. Returning the object instead type-checks nowhere — and the tests still pass,
 * because runtime does not care. That gap is why this helper exists rather than a bare `return {…}`.
 */
const json = (result: ViewImageResult): string => JSON.stringify(result);

/** Read an image from the project so the model can look at it. */
export function createViewImageTool(options: CreateViewImageToolOptions): CustomTool {
  const { projectRoot } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  return Tool.create({
    name: options.name ?? "view_image",
    description:
      options.description ??
      "Read an image file from the project and show it to the model. Supports png, jpeg, gif and webp.",
    inputSchema: z.object({
      path: z.string().describe("Path to the image, relative to the project root."),
    }),
    handler: (input: { path: string }) => {
      // Reuse the shared guard rather than re-deriving confinement: the copies would have to agree
      // on what counts as an escape, and one fixed without the other reopens the hole in the
      // forgotten tool. `checkPathScope` returns the pre-formatted refusal or null.
      const refused = checkPathScope(input.path, projectRoot);
      if (refused !== null) return refused;

      // The any-segment secret guard, for the same reason `read-file` and `list-dir` carry it: a
      // path may put `.env` or `.git` deeper than the first segment, and an extension check would
      // wave `.env/logo.png` straight through.
      if (isForbiddenAtAnyDepth(input.path)) {
        return json({ ok: false, error: "path_traversal", path: input.path });
      }

      const mediaType = MEDIA_TYPES.get(extname(input.path).toLowerCase());
      if (mediaType === undefined) {
        return json({
          ok: false,
          error: "unsupported_image_type",
          path: input.path,
          supported: [...MEDIA_TYPES.keys()],
        });
      }

      const absolute = safePathJoin(projectRoot, input.path);

      const outcome = readWithinBudget(absolute, maxBytes);
      if (!outcome.ok) return json(failureFor(outcome, input.path, maxBytes));

      return json({
        ok: true,
        path: input.path,
        media_type: mediaType,
        bytes: outcome.bytes,
        data: outcome.data,
      } satisfies ViewImageOk);
    },
    /**
     * Turn a successful read into an image block.
     *
     * A failed read stays TEXT on purpose: the model needs to read "not_found" and try another path,
     * and an error is not something to look at.
     */
    toModelOutput: (output: string): string | ToolResultContentBlock[] => {
      // `output` is exactly what the handler returned — the envelope, as a string.
      let result: ViewImageResult;
      try {
        result = JSON.parse(output) as ViewImageResult;
      } catch {
        return output;
      }
      // A failure stays TEXT on purpose: the model needs to READ "not_found" and try another path,
      // and an error is not something to look at.
      if (result.ok !== true) return output;
      return [
        {
          type: "image",
          source: { type: "base64", media_type: result.media_type, data: result.data },
        },
      ];
    },
  }) as unknown as CustomTool;
}

/** Outcome of {@link readWithinBudget} — a read that succeeded, or the reason it did not. */
type ReadOutcome =
  | { readonly ok: true; readonly bytes: number; readonly data: string }
  | { readonly ok: false; readonly error: "not_found" }
  | { readonly ok: false; readonly error: "too_large"; readonly bytes: number };

/**
 * Sizes and reads one file through a single descriptor, refusing anything over `maxBytes`.
 *
 * Its own function for two reasons. It has one responsibility — get the bytes, or say why not —
 * which the tool handler above does not share; and inlining it pushed the handler past the
 * repository's cognitive-complexity budget, which is the gate asking for exactly this split
 * rather than for a suppression.
 *
 * The single descriptor is the point (CodeQL js/file-system-race #22). `statSync(path)` followed
 * by `readFileSync(path)` is two lookups of one name, and the size cap — the only thing keeping an
 * unbudgeted image out of an LLM's context — described a file that need not be the one returned.
 * An fd cannot be swapped.
 */
function readWithinBudget(absolute: string, maxBytes: number): ReadOutcome {
  let fd: number;
  try {
    fd = openSync(absolute, "r");
  } catch {
    return { ok: false, error: "not_found" };
  }

  try {
    const bytes = fstatSync(fd).size;
    // `>` and not `>=`: a file of exactly the limit fits. Off by one here refuses an image the
    // operator deliberately sized to the cap.
    if (bytes > maxBytes) return { ok: false, error: "too_large", bytes };
    return { ok: true, bytes, data: readFileSync(fd).toString("base64") };
  } finally {
    // Always — the early return on the size cap must not leak the descriptor.
    closeSync(fd);
  }
}

/**
 * Turns a refused read into the tool's failure envelope.
 *
 * Separate from the handler because it is a mapping, not a decision the handler makes — and
 * because keeping it inline held the handler one point above the cognitive-complexity budget.
 */
function failureFor(
  outcome: {
    readonly ok: false;
    readonly error: "not_found" | "too_large";
    readonly bytes?: number;
  },
  path: string,
  maxBytes: number,
): ViewImageFailure {
  if (outcome.error === "not_found") return { ok: false, error: "not_found", path };
  return {
    ok: false,
    error: "image_too_large",
    path,
    bytes: outcome.bytes,
    limit_bytes: maxBytes,
  };
}
