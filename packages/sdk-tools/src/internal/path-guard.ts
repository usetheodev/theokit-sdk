/**
 * Pure re-export of the canonical path-guard (#150).
 *
 * This module USED TO BE a vendored copy of `@theokit/sdk`'s implementation, consumed by the 9 tools
 * that touch paths. Duplicating a **security** primitive across packages meant the canonical one
 * evoluiu — blocklist de credenciais (`.ssh` `.aws` `.kube` `.npmrc` `id_rsa` `authorized_keys`
 * `*.pem` `*.key` `*.p12`), case-insensitive normalization, NUL/control-char rejection (T5.5), the
 * filesystem-root base fix (#149) — while the copy stood still. Nothing in CI compared the two, and the
 * divergence grew with every fix applied to only one side: an agent could read `.ssh/id_rsa`,
 * `.aws/credentials` e `*.pem` pelo fork.
 *
 * The file remains as a re-export point so the 9 consumers need not change their imports
 * (and so this comment sits in the path of anyone tempted to vendor again). It does NOT
 * host an implementation: `@theokit/sdk` is already a peerDependency, and every symbol the consumers use
 * is public in `@theokit/sdk/path-safety`.
 *
 * The regression is locked by `tests/path-guard-no-fork.test.ts`, which asserts PARITY with the canonical one — the
 * defect was the duplication, not its version, and reintroducing an up-to-date copy would only restart the
 * divergence clock.
 *
 * @internal
 */

export {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from "@theokit/sdk/path-safety";
