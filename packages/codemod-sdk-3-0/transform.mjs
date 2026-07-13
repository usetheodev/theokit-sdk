/**
 * @theokit/codemod-sdk-3-0 — jscodeshift transform for the SE36 uniform `X.create()` API.
 *
 * Rewrites every removed public factory to its `X.create` namespace form, in BOTH the import
 * specifiers (from `@theokit/sdk` and its subpath entrypoints) and the call sites:
 *
 *   import { defineTool } from "@theokit/sdk";  ->  import { Tool } from "@theokit/sdk";
 *   const t = defineTool({ ... });              ->  const t = Tool.create({ ... });
 *
 * Purely syntactic (no type info needed) — proven against the in-tree examples suite.
 * Usage: npx jscodeshift -t transform.mjs <path> --parser=ts --extensions=ts,tsx,mts,cts,js,mjs
 */

// old public factory identifier -> new namespace class
export const SE36_MAP = {
  defineTool: "Tool",
  defineProvider: "Provider",
  definePlugin: "Plugin",
  defineSkillReadTool: "SkillReadTool",
  defineSubAgent: "SubAgent",
  createSquad: "Squad",
  createSkill: "Skill",
  createSessionManager: "Session",
  createAgentFactory: "AgentFactory",
  createNoopMemoryProvider: "NoopMemoryProvider",
  createPermissionPlugin: "PermissionPlugin",
  createTokenLimiter: "TokenLimiter",
  createUnicodeNormalizer: "UnicodeNormalizer",
  defineSubscription: "Subscription",
  createSemaphore: "Semaphore",
  defineAuth: "Auth",
  withRetry: "Retry",
};

const isSdkSource = (v) =>
  typeof v === "string" && (v === "@theokit/sdk" || v.startsWith("@theokit/sdk/"));

// type-only marked on the specifier (`import { type X }`) OR the declaration (`import type { X }`)
const isTypeSpec = (decl, s) => decl.importKind === "type" || s.importKind === "type";

const mapsAFactory = (s) => s.type === "ImportSpecifier" && Boolean(SE36_MAP[s.imported.name]);

// Merge one specifier into `kept` (name -> specifier), preferring a value import over a type-only one.
function mergeSpecifier(kept, s, produced, j) {
  if (s.type !== "ImportSpecifier") {
    kept.set(Symbol(), s); // namespace/default — keep verbatim
    return;
  }
  const finalName = SE36_MAP[s.imported.name] ?? s.imported.name;
  const spec = j.importSpecifier(j.identifier(finalName));
  spec.importKind = produced.has(finalName) ? "value" : s.importKind;
  const prev = kept.get(finalName);
  const preferNew = !prev || (prev.importKind === "type" && spec.importKind !== "type");
  if (preferNew) kept.set(finalName, spec);
}

function rewrittenSpecifiers(decl, j) {
  const produced = new Set(
    decl.specifiers.filter(mapsAFactory).map((s) => SE36_MAP[s.imported.name]),
  );
  const kept = new Map();
  for (const s of decl.specifiers) mergeSpecifier(kept, s, produced, j);
  return [...kept.values()];
}

// Pass 1 — rewrite import specifiers from @theokit/sdk[/subpath]; a produced class is a value import.
function rewriteImports(root, j) {
  let changed = false;
  root.find(j.ImportDeclaration).forEach((p) => {
    if (!isSdkSource(p.node.source.value)) return;
    if (p.node.specifiers.some(mapsAFactory)) changed = true;
    p.node.specifiers = rewrittenSpecifiers(p.node, j);
  });
  return changed;
}

// Pass 2 — rewrite call sites: identifier callee in the map -> `X.create`.
function rewriteCallSites(root, j) {
  let changed = false;
  root.find(j.CallExpression, { callee: { type: "Identifier" } }).forEach((p) => {
    const cls = SE36_MAP[p.node.callee.name];
    if (cls) {
      p.node.callee = j.memberExpression(j.identifier(cls), j.identifier("create"));
      changed = true;
    }
  });
  return changed;
}

// Pass 3 — cross-declaration cleanup: when a produced class (e.g. `Plugin`) is value-imported,
// drop any separate `import type { Plugin }` from the same sdk source (the value import carries both).
function dedupeTypeImports(root, j) {
  let changed = false;
  const producedClasses = new Set(Object.values(SE36_MAP));
  const valueImported = new Set();
  root.find(j.ImportDeclaration).forEach((p) => {
    if (!isSdkSource(p.node.source.value)) return;
    for (const s of p.node.specifiers) {
      if (
        s.type === "ImportSpecifier" &&
        !isTypeSpec(p.node, s) &&
        producedClasses.has(s.imported.name)
      )
        valueImported.add(s.imported.name);
    }
  });
  root.find(j.ImportDeclaration).forEach((p) => {
    if (!isSdkSource(p.node.source.value)) return;
    const before = p.node.specifiers.length;
    p.node.specifiers = p.node.specifiers.filter(
      (s) =>
        !(
          s.type === "ImportSpecifier" &&
          isTypeSpec(p.node, s) &&
          valueImported.has(s.imported.name)
        ),
    );
    if (p.node.specifiers.length !== before) changed = true;
    if (p.node.specifiers.length === 0) j(p).remove();
  });
  return changed;
}

export default function transform(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  const c1 = rewriteImports(root, j);
  const c2 = rewriteCallSites(root, j);
  const c3 = dedupeTypeImports(root, j);
  return c1 || c2 || c3 ? root.toSource({ quote: "double" }) : null;
}
