/**
 * Module-loader — walks @Module() classes in BFS order, registers their
 * providers, validates imports + exports visibility, detects cyclic imports.
 *
 * Per ADR D4: modules are OPT-IN. Default usage is flat container.
 * Per v1.1 EC-4: registerModule() rejects undecorated classes with
 * InvalidModuleError pointing to the missing decorator.
 */

import type { Container } from "../container.js";
import { type ModuleMetadata, readModuleMetadata } from "../decorators/module.js";
import { describeToken } from "../errors.js";
import type { ClassConstructor, Provider, Token } from "../types.js";

/**
 * Thrown when a class is passed to `Container.registerModule()` without
 * the `@Module()` decorator (v1.1 EC-4 MUST FIX).
 */
export class InvalidModuleError extends Error {
  override readonly name = "InvalidModuleError" as const;
  constructor(public readonly target: { name?: string }) {
    super(
      `Class ${target.name ?? "<anonymous>"} has no @Module() decorator. ` +
        "Add @Module({ providers: [...], imports: [...], exports: [...] }) above the class declaration.",
    );
  }
}

/**
 * Thrown when a module declares an export for a token that isn't in its
 * own `providers` (v1.1 EC-8 SHOULD TEST — pin register-time validation).
 */
export class InvalidExportError extends Error {
  override readonly name = "InvalidExportError" as const;
  constructor(
    public readonly moduleName: string,
    public readonly token: Token,
  ) {
    super(
      `Module ${moduleName} exports token ${describeToken(token)} but it is not in providers[]. ` +
        "Add it to providers[] or remove it from exports[].",
    );
  }
}

/**
 * Thrown when module imports form a cycle (Module A imports B, B imports A).
 */
export class CyclicModuleImportError extends Error {
  override readonly name = "CyclicModuleImportError" as const;
  constructor(public readonly cycle: ReadonlyArray<string>) {
    super(`Cyclic module imports detected: ${cycle.join(" → ")}`);
  }
}

interface LoadedModule {
  readonly target: ClassConstructor;
  readonly metadata: ModuleMetadata;
}

/**
 * Walk a root module + all transitively imported modules. Register every
 * module's providers into the container. Validate exports.
 *
 * Module-visibility (exports/imports) is documented but the container
 * itself does NOT enforce token-level visibility at resolve-time in v1 —
 * once a provider is registered, it's resolvable from anywhere (NestJS-flat
 * pattern). The exports[] field is validated for correctness so users get
 * type-level documentation, but enforcement is deferred to v2.
 */
export function loadModule(rootModule: ClassConstructor, container: Container): void {
  const visited = new Set<ClassConstructor>();
  const loaded: LoadedModule[] = [];

  // DFS with a path stack so we can detect cycles by checking whether the
  // current target is on the active path.
  function visit(target: ClassConstructor, path: ClassConstructor[]): void {
    if (path.includes(target)) {
      // Cycle — slice from where it starts.
      const cycleStart = path.indexOf(target);
      const cycleNames = [...path.slice(cycleStart).map((m) => m.name), target.name];
      throw new CyclicModuleImportError(cycleNames);
    }
    if (visited.has(target)) return;

    const metadata = readModuleMetadata(target);
    if (metadata === undefined) {
      throw new InvalidModuleError(target as { name?: string });
    }

    visited.add(target);
    const childPath = [...path, target];
    for (const imported of metadata.imports ?? []) {
      visit(imported, childPath);
    }
    loaded.push({ target, metadata });
  }

  visit(rootModule, []);

  // Register every loaded module's providers. Iteration order is
  // post-order DFS — imported modules are registered before importers.
  for (const { target, metadata } of loaded) {
    for (const provider of metadata.providers ?? []) {
      container.register(provider);
    }
    validateExports(target.name, metadata);
  }
}

function validateExports(moduleName: string, metadata: ModuleMetadata): void {
  if (metadata.exports === undefined) return;
  const providerTokens = new Set<Token>();
  for (const provider of metadata.providers ?? []) {
    if (typeof provider === "function") {
      providerTokens.add(provider as Token);
    } else {
      providerTokens.add((provider as Provider).provide);
    }
  }
  for (const exported of metadata.exports) {
    if (!providerTokens.has(exported)) {
      throw new InvalidExportError(moduleName, exported);
    }
  }
}
