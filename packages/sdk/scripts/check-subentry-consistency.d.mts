// Hand-written declaration for check-subentry-consistency.mjs. The script itself stays plain
// JS + JSDoc (it is a `check`-level tool, not part of the published package), but importing it
// from a TypeScript test needs a real module type — otherwise `tsc --noEmit` fails with TS7016
// under this repo's `moduleResolution: "Bundler"` (no `allowJs`).

export interface SubentryProblem {
  exportPath: string;
  entryKey: string;
  missing: string[];
}

export interface CheckSubentryConsistencyArgs {
  exportsMap: Record<string, unknown>;
  tsupSrc: string;
  tsconfigInclude: string[];
  mirrorSrc: string;
}

export function parseEntryBlock(src: string, blockStartRegex: RegExp): Record<string, string>;
export function parseMirrorTargets(src: string): string[];
export function checkSubentryConsistency(args: CheckSubentryConsistencyArgs): SubentryProblem[];
