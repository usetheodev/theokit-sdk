import { describe, expect, it } from "vitest";
import {
  type CommandPolicy,
  commandDenialReason,
  denyCatastrophicCommands,
  isCommandAllowed,
} from "../src/internal/command-policy.js";
import { catastrophicShellReason } from "../src/internal/shell-guard.js";

const allowAll: CommandPolicy = () => null;
const denyAll: CommandPolicy = () => "denied by test policy";

describe("denyCatastrophicCommands", () => {
  it("denies a catastrophic command", () => {
    expect(denyCatastrophicCommands()("rm -rf /")).not.toBeNull();
  });

  it("allows a safe command", () => {
    expect(denyCatastrophicCommands()("ls -la")).toBeNull();
  });

  it("returns the SAME reason as catastrophicShellReason (composition, no duplication)", () => {
    expect(denyCatastrophicCommands()("rm -rf /")).toBe(catastrophicShellReason("rm -rf /"));
  });
});

describe("isCommandAllowed / commandDenialReason", () => {
  it("allows a safe command under the catastrophic policy", () => {
    expect(isCommandAllowed("ls", [denyCatastrophicCommands()])).toBe(true);
  });

  it("denies a catastrophic command under the catastrophic policy", () => {
    expect(isCommandAllowed("rm -rf /", [denyCatastrophicCommands()])).toBe(false);
  });

  it("commandDenialReason returns the exact M3-2 deny reason", () => {
    expect(commandDenialReason("rm -rf /", [denyCatastrophicCommands()])).toBe(
      catastrophicShellReason("rm -rf /"),
    );
  });

  it("treats an empty-string policy return as a deny (not allow) — `null` is the allow sentinel", () => {
    const emptyReasonPolicy: CommandPolicy = () => "";
    expect(commandDenialReason("ls", [emptyReasonPolicy])).toBe("");
    expect(isCommandAllowed("ls", [emptyReasonPolicy])).toBe(false);
  });

  it("first deny wins regardless of order (iteration continues past an allower)", () => {
    expect(commandDenialReason("ls", [denyAll, allowAll])).toBe("denied by test policy");
    expect(commandDenialReason("rm -rf /", [allowAll, denyCatastrophicCommands()])).toBe(
      catastrophicShellReason("rm -rf /"),
    );
  });

  it("an empty policy list allows everything (EC-1)", () => {
    expect(isCommandAllowed("rm -rf /", [])).toBe(true);
    expect(commandDenialReason("rm -rf /", [])).toBeNull();
  });
});

describe("sdk-tools barrel — command-policy", () => {
  it("re-exports the policy helpers", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.denyCatastrophicCommands).toBe("function");
    expect(typeof mod.isCommandAllowed).toBe("function");
    expect(typeof mod.commandDenialReason).toBe("function");
  });
});
