/**
 * SDK 2.0 split migration codemod — jscodeshift transformer.
 * (Phase 8 / T8.1; plan v1.1 absorbed EC-3 + EC-4 transforms.)
 *
 * CommonJS — jscodeshift loads transformers via `require()`.
 *
 * Usage:
 *   # Dry-run (default — prints diff, no file changes):
 *   npx jscodeshift -t scripts/migrations/1-x-to-2-0.cjs <path> --parser=tsx --extensions=ts,tsx
 *
 *   # Apply changes:
 *   add --no-dry-run? No — `--dry` in jscodeshift opts means "no write".
 *   jscodeshift writes IN PLACE by default. Use git or --dry to preview.
 *
 * What it does — see scripts/migrations/1-x-to-2-0.mjs (replaced by this
 * .cjs version due to jscodeshift's CJS-only loader). Same semantics,
 * same fixtures.
 *
 * @internal — only invoked via jscodeshift CLI.
 */

"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const MAP_PATH = join(__dirname, "1-x-to-2-0-map.json");
const SDK_OLD_SUB_PATHS = new Map([["@theokit/sdk/tools", "@theokit/sdk-tools"]]);
const SDK_BARREL = "@theokit/sdk";

function loadMap() {
  const raw = JSON.parse(readFileSync(MAP_PATH, "utf-8"));
  const result = new Map();
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("$")) continue;
    if (typeof value !== "string") continue;
    result.set(key, value);
  }
  return result;
}

const SYMBOL_MAP = loadMap();

const BUDGET_TRACKER_COMMENT_LINES = [
  " CODEMOD-WARN: SDK 2.0 — Agent.create no longer auto-creates Budget.",
  "   Add budgetTracker explicitly to keep enforcement, or accept free-run mode.",
  "   See docs/migration/1-x-to-2-0.md#budget-tracker",
];

const HANDOFFS_COMMENT_LINES = [
  " CODEMOD: handoffs option removed in 2.0 — wrap target agents with Handoff.asPlugin({ targets: [...] }) and pass via plugins array.",
  "   Before: Agent.create({ handoffs: [a, b] })",
  "   After:  Agent.create({ plugins: [Handoff.asPlugin({ targets: [a, b] })] })",
  "   See docs/migration/1-x-to-2-0.md#handoff",
];

const SIDE_EFFECT_COMMENT_LINES = [
  " CODEMOD: side-effect import of @theokit/sdk — manual review required.",
  "   The 2.0 split has no side-effect entry point; verify this import is still needed.",
];

const NAMESPACE_COMMENT_LINES = [
  " CODEMOD: namespace import of @theokit/sdk — manual review required.",
  "   Cross-package namespace imports don't compose. Switch to named imports + the codemod will split them.",
];

function hasLeadingCommentWithText(node, fragment) {
  const comments = node.comments || node.leadingComments || [];
  return comments.some(
    (c) => typeof c.value === "string" && c.value.includes(fragment),
  );
}

function buildLineComments(j, lines) {
  return lines.map((l) => j.commentLine(l));
}

function addLeadingComment(j, node, fragmentToCheck, commentLines) {
  if (hasLeadingCommentWithText(node, fragmentToCheck)) return;
  const existing = node.comments || [];
  node.comments = existing.concat(buildLineComments(j, commentLines));
}

function bucketSpecifiers(specifiers, fileForLog, lineForLog) {
  const byTarget = new Map();
  const unknown = [];
  let defaultSpec = null;
  let namespaceSpec = null;

  for (const spec of specifiers) {
    if (spec.type === "ImportDefaultSpecifier") {
      defaultSpec = spec;
      continue;
    }
    if (spec.type === "ImportNamespaceSpecifier") {
      namespaceSpec = spec;
      continue;
    }
    if (spec.type !== "ImportSpecifier") continue;
    const name = spec.imported.name;
    const local = (spec.local && spec.local.name) || name;
    const isTypeOnly = spec.importKind === "type";
    const target = SYMBOL_MAP.get(name);
    const wrap = { name, local, isTypeOnly };
    if (target === undefined) {
      unknown.push(wrap);
      console.warn(
        `[codemod] WARN ${fileForLog}:${lineForLog} — symbol "${name}" not in 1-x-to-2-0-map.json (kept in @theokit/sdk)`,
      );
      continue;
    }
    const existing = byTarget.get(target);
    if (existing === undefined) byTarget.set(target, [wrap]);
    else existing.push(wrap);
  }

  return { byTarget, unknown, defaultSpec, namespaceSpec };
}

/**
 * Walk from a deep CallExpression path UP to the nearest enclosing
 * Statement (VariableDeclaration / ExpressionStatement / ReturnStatement
 * etc.). The Statement is where leading comments belong — placing them
 * on inner expressions (AwaitExpression, VariableDeclarator) leaves recast
 * to put them in the wrong place AND breaks idempotency because the comment
 * check then looks at the wrong node.
 */
function walkUpToStatement(path) {
  let cursor = path;
  while (cursor.parent && cursor.node) {
    const t = cursor.node.type;
    if (
      t === "ExpressionStatement" ||
      t === "VariableDeclaration" ||
      t === "ReturnStatement" ||
      t === "IfStatement" ||
      t === "ThrowStatement" ||
      t === "ForStatement" ||
      t === "ForOfStatement" ||
      t === "ForInStatement" ||
      t === "WhileStatement"
    ) {
      return cursor.node;
    }
    cursor = cursor.parent;
  }
  return path.node; // fallback — top-level expression
}

function buildImportDecl(j, target, specs, sourceImportKind) {
  const importKind = sourceImportKind === "type" ? "type" : "value";
  return {
    type: "ImportDeclaration",
    specifiers: specs.map((s) => ({
      type: "ImportSpecifier",
      imported: j.identifier(s.name),
      local: j.identifier(s.local),
      importKind: s.isTypeOnly ? "type" : importKind,
    })),
    source: j.stringLiteral(target),
    importKind: importKind,
  };
}

module.exports = function transform(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let changed = false;

  // ── (A) Sub-path rewrites: @theokit/sdk/tools → @theokit/sdk-tools ──
  for (const [oldSource, newSource] of SDK_OLD_SUB_PATHS) {
    root
      .find(j.ImportDeclaration, { source: { value: oldSource } })
      .forEach((path) => {
        path.node.source = j.stringLiteral(newSource);
        changed = true;
      });
    root
      .find(j.ExportNamedDeclaration, { source: { value: oldSource } })
      .forEach((path) => {
        path.node.source = j.stringLiteral(newSource);
        changed = true;
      });
  }

  // ── (B) Named/default/namespace imports from @theokit/sdk barrel ──
  root
    .find(j.ImportDeclaration, { source: { value: SDK_BARREL } })
    .forEach((path) => {
      const specifiers = path.node.specifiers;
      if (specifiers === null || specifiers === undefined || specifiers.length === 0) {
        addLeadingComment(
          j,
          path.node,
          "CODEMOD: side-effect import",
          SIDE_EFFECT_COMMENT_LINES,
        );
        changed = true;
        return;
      }

      const line = (path.node.loc && path.node.loc.start.line) || "?";
      const { byTarget, unknown, defaultSpec, namespaceSpec } = bucketSpecifiers(
        specifiers,
        file.path,
        line,
      );

      if (namespaceSpec !== null) {
        addLeadingComment(
          j,
          path.node,
          "CODEMOD: namespace import",
          NAMESPACE_COMMENT_LINES,
        );
        changed = true;
        return;
      }

      if (byTarget.size === 0 && unknown.length === specifiers.length) {
        // Nothing to rewrite.
        return;
      }

      const sourceImportKind = path.node.importKind || "value";
      const replacements = [];

      if (defaultSpec !== null || unknown.length > 0) {
        const preservedSpecs = [];
        if (defaultSpec !== null) preservedSpecs.push(defaultSpec);
        for (const u of unknown) {
          preservedSpecs.push({
            type: "ImportSpecifier",
            imported: j.identifier(u.name),
            local: j.identifier(u.local),
            importKind: u.isTypeOnly ? "type" : sourceImportKind,
          });
        }
        replacements.push({
          type: "ImportDeclaration",
          specifiers: preservedSpecs,
          source: j.stringLiteral(SDK_BARREL),
          importKind: sourceImportKind,
        });
      }

      for (const [target, specs] of byTarget) {
        replacements.push(buildImportDecl(j, target, specs, sourceImportKind));
      }

      j(path).replaceWith(replacements);
      changed = true;
    });

  // ── (C) export { X } from "@theokit/sdk" → re-export from new target ──
  root
    .find(j.ExportNamedDeclaration, { source: { value: SDK_BARREL } })
    .forEach((path) => {
      const specs = path.node.specifiers || [];
      if (specs.length === 0) return;
      const line = (path.node.loc && path.node.loc.start.line) || "?";

      const byTarget = new Map();
      const preserved = [];

      for (const spec of specs) {
        if (spec.type !== "ExportSpecifier") {
          preserved.push(spec);
          continue;
        }
        const name = spec.local.name;
        const exportedAs = (spec.exported && spec.exported.name) || name;
        const target = SYMBOL_MAP.get(name);
        if (target === undefined) {
          preserved.push(spec);
          console.warn(
            `[codemod] WARN ${file.path}:${line} — re-exported symbol "${name}" not in map (kept on @theokit/sdk)`,
          );
          continue;
        }
        const entry = byTarget.get(target);
        const wrap = { name, exportedAs };
        if (entry === undefined) byTarget.set(target, [wrap]);
        else entry.push(wrap);
      }

      if (byTarget.size === 0) return;

      const replacements = [];
      if (preserved.length > 0) {
        const cloned = Object.assign({}, path.node);
        cloned.specifiers = preserved;
        replacements.push(cloned);
      }
      for (const [target, list] of byTarget) {
        replacements.push({
          type: "ExportNamedDeclaration",
          declaration: null,
          specifiers: list.map((w) => ({
            type: "ExportSpecifier",
            local: j.identifier(w.name),
            exported: j.identifier(w.exportedAs),
          })),
          source: j.stringLiteral(target),
        });
      }
      j(path).replaceWith(replacements);
      changed = true;
    });

  // ── (D) EC-3: Agent.create({...}) without budgetTracker ──
  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object: { name: "Agent" },
        property: { name: "create" },
      },
    })
    .forEach((path) => {
      const arg = path.node.arguments && path.node.arguments[0];
      if (arg === undefined || arg === null || arg.type !== "ObjectExpression") return;
      const hasBudget = arg.properties.some((p) => {
        if (!p || (p.type !== "ObjectProperty" && p.type !== "Property")) return false;
        const k = p.key;
        if (!k) return false;
        if (k.type === "Identifier" && k.name === "budgetTracker") return true;
        if (k.type === "StringLiteral" && k.value === "budgetTracker") return true;
        if (k.type === "Literal" && k.value === "budgetTracker") return true;
        return false;
      });
      if (!hasBudget) {
        const target = walkUpToStatement(path);
        if (!hasLeadingCommentWithText(target, "Agent.create no longer auto-creates Budget")) {
          addLeadingComment(j, target, "Agent.create no longer auto-creates Budget", BUDGET_TRACKER_COMMENT_LINES);
          changed = true;
        }
      }
    });

  // ── (E) EC-4: Agent.create({ handoffs: ... }) ──
  root
    .find(j.CallExpression, {
      callee: {
        type: "MemberExpression",
        object: { name: "Agent" },
        property: { name: "create" },
      },
    })
    .forEach((path) => {
      const arg = path.node.arguments && path.node.arguments[0];
      if (arg === undefined || arg === null || arg.type !== "ObjectExpression") return;
      const hasHandoffs = arg.properties.some((p) => {
        if (!p || (p.type !== "ObjectProperty" && p.type !== "Property")) return false;
        const k = p.key;
        if (!k) return false;
        if (k.type === "Identifier" && k.name === "handoffs") return true;
        if (k.type === "StringLiteral" && k.value === "handoffs") return true;
        if (k.type === "Literal" && k.value === "handoffs") return true;
        return false;
      });
      if (hasHandoffs) {
        const target = walkUpToStatement(path);
        if (!hasLeadingCommentWithText(target, "handoffs option removed in 2.0")) {
          addLeadingComment(j, target, "handoffs option removed in 2.0", HANDOFFS_COMMENT_LINES);
          changed = true;
        }
      }
    });

  if (!changed) return file.source;
  return root.toSource({ quote: "double", reuseWhitespace: true });
};

module.exports.parser = "tsx";
