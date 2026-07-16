/**
 * Barrel for the local runtime agent (SE43 DoD#1 — promoted out of
 * `internal/runtime/` to reduce that package's blast radius). External
 * consumers import the local-agent surface through this barrel.
 */

export { LocalAgent } from "./local-agent.js";
