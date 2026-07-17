---
user-invocable: false
description: Discover SKILL.md packs and render the <skills> block with @theokit/sdk/skills, plus enabling skills on an agent.
paths:
  - "**/*skill*"
  - "**/*Skill*"
---

# TheoKit SDK -- Skills

`discoverSkills` walks a directory for `<dir>/<name>/SKILL.md` packs, parses strict YAML frontmatter (`name`/`description` required; `category`/`dependencies` optional), skips malformed skills and symlink escapes, and NEVER throws (a missing/unreadable/non-directory path yields `[]`). `buildSkillsBlock` renders the prompt-injection-safe `<skills>` system-prompt block from the discovered list. These are the same primitives the SDK runtime uses internally for `.theokit/skills` discovery.

## Import

```typescript
import { discoverSkills, buildSkillsBlock } from "@theokit/sdk/skills";
import type { Skill, DiscoverSkillsOptions, InvalidSkillInfo } from "@theokit/sdk/skills";
```

## Signatures

```typescript
function discoverSkills(dir: string, options?: DiscoverSkillsOptions): Promise<Skill[]>;
function buildSkillsBlock(
  skills: ReadonlyArray<{ name: string; description: string }>,
): string | undefined; // undefined for an empty list

interface Skill {
  name: string;
  description: string;
  source: string;         // absolute path to the discovered SKILL.md
  category?: string;
  dependencies?: string[];
}

interface DiscoverSkillsOptions {
  onInvalidSkill?: (info: InvalidSkillInfo) => void; // called per malformed SKILL.md
}
```

## Discover and render

```typescript
const skills = await discoverSkills(".theokit/skills", {
  onInvalidSkill: (info: InvalidSkillInfo) =>
    console.warn(`skipped ${info.name}: ${info.code} — ${info.message}`),
});

// readdir order is OS-dependent; sort for a stable block
skills.sort((a, b) => a.name.localeCompare(b.name));

const block = buildSkillsBlock(skills); // string | undefined
```

## Skill packs live at `.theokit/skills/<name>/SKILL.md`

Each pack is a directory with a `SKILL.md` whose frontmatter has `name` + `description`. Enable specific packs on an agent by name:

```typescript
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  skills: { enabled: ["research", "code-review"] },
});
```
