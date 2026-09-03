/**
 * PersonalityRegistry — loads `.theokit/personalities/*.md` from project
 * + user dirs (T1.1, ADRs D161 / D162).
 *
 * Project entries win on slug collision (matches `.theokit/` family
 * convention). Reserved slugs (`none`, `default`, `neutral`) cannot be
 * registered — they map to "clear active preset".
 *
 * **EC-C:** name regex enforced lowercase-only by the Zod schema in
 * `types.ts`. Filenames are independent of the frontmatter `name`.
 *
 * **EC-M (documented):** body content is NOT sanitized against
 * prompt-injection — users own their preset content.
 *
 * @internal
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { ConfigurationError } from "../../errors.js";
import { loadMarkdownEntities } from "../persistence/markdown-config-loader.js";
import { theokitConfigRoot } from "../persistence/paths.js";
import { warnOnce } from "../runtime/hooks/hooks-source.js";
import {
  type PersonalityFrontmatter,
  PersonalityFrontmatterSchema,
  type PersonalityPreset,
  RESERVED_CLEAR_SLUGS,
} from "./types.js";

// PROJECT and USER intentionally share this relative suffix under two different roots.
const PERSONALITIES_SUFFIX = "personalities";
const USER_SUBDIR = ".theokit/personalities";

/**
 * Reads project + user personality directories and exposes a
 * collision-resolved registry.
 *
 * @internal
 */
export class PersonalityRegistry {
  readonly #byName: Map<string, PersonalityPreset>;

  private constructor(presets: ReadonlyArray<PersonalityPreset>) {
    this.#byName = new Map();
    for (const p of presets) this.#byName.set(p.name, p);
  }

  /**
   * Load project + user dirs. Project entries override user entries on
   * slug collision (`source: "project"` wins).
   *
   * @internal
   */
  static async load(cwd: string): Promise<PersonalityRegistry> {
    const projectDir = join(theokitConfigRoot(cwd), PERSONALITIES_SUFFIX);
    const userDir = join(homedir(), USER_SUBDIR);

    const [userEntities, projectEntities] = await Promise.all([
      loadMarkdownEntities({
        dir: userDir,
        schema: PersonalityFrontmatterSchema,
        pattern: "flat",
        errorCodePrefix: "personality",
      }),
      loadMarkdownEntities({
        dir: projectDir,
        schema: PersonalityFrontmatterSchema,
        pattern: "flat",
        errorCodePrefix: "personality",
      }),
    ]);

    const byName = new Map<string, PersonalityPreset>();
    // Load user first so project can override.
    for (const e of userEntities) addEntity(byName, e, "user");
    for (const e of projectEntities) addEntity(byName, e, "project", byName);

    return new PersonalityRegistry(
      [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  /** All loaded presets, lex-asc by name. */
  all(): ReadonlyArray<PersonalityPreset> {
    return [...this.#byName.values()];
  }

  /** Get by slug. Returns undefined for unknown OR reserved slugs. */
  get(name: string): PersonalityPreset | undefined {
    if (PersonalityRegistry.isReservedClearSlug(name)) return undefined;
    return this.#byName.get(name);
  }

  /** Reserved slugs map to "clear active preset". */
  static isReservedClearSlug(name: string): boolean {
    return (RESERVED_CLEAR_SLUGS as readonly string[]).includes(name);
  }
}

function addEntity(
  byName: Map<string, PersonalityPreset>,
  entity: { slug: string; frontmatter: PersonalityFrontmatter; body: string; source: string },
  origin: "project" | "user",
  collisionMap?: Map<string, PersonalityPreset>,
): void {
  const fm = entity.frontmatter;
  if (PersonalityRegistry.isReservedClearSlug(fm.name)) {
    throw new ConfigurationError(
      `Personality name "${fm.name}" is reserved (used to clear active preset)`,
      { code: "personality_reserved_name" },
    );
  }
  // EC-1 of T1.1: empty body → reject.
  if (entity.body.trim().length === 0) {
    throw new ConfigurationError(
      `Personality "${fm.name}" has empty body (system prompt required)`,
      { code: "personality_empty_body" },
    );
  }
  // Project wins on collision; emit warning once per slug.
  if (origin === "project" && collisionMap?.has(fm.name)) {
    warnOnce(
      `personality-collision-${fm.name}`,
      `[theokit-sdk] personality "${fm.name}" overridden by project preset`,
    );
  }
  byName.set(fm.name, {
    name: fm.name,
    description: fm.description,
    tools: fm.tools,
    model: fm.model,
    tags: fm.tags,
    systemPrompt: entity.body,
    source: origin,
    sourcePath: entity.source,
  });
}
