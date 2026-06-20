import { describe, expect, it } from "vitest";

import { CatastrophicCommandError, catastrophicShellReason } from "../src/internal/shell-guard.js";

describe("catastrophicShellReason — rm -rf of root/home/glob", () => {
  it("blocks 'rm -rf /', 'rm -rf ~', 'rm -fr /*'", () => {
    expect(catastrophicShellReason("rm -rf /")).toBeTruthy();
    expect(catastrophicShellReason("rm -rf ~")).toBeTruthy();
    expect(catastrophicShellReason("rm -fr /*")).toBeTruthy();
  });

  it("blocks root-target variants 'rm -rf //', 'rm -rf \"/\"', 'rm -rf / ' (EC-2)", () => {
    expect(catastrophicShellReason("rm -rf //")).toBeTruthy();
    expect(catastrophicShellReason('rm -rf "/"')).toBeTruthy();
    expect(catastrophicShellReason("rm -rf / ")).toBeTruthy();
  });

  it("blocks 'rm -rf /' hidden after a chain 'ls && rm -rf /' (EC-1)", () => {
    expect(catastrophicShellReason("ls && rm -rf /")).toBeTruthy();
  });

  it("blocks 'sudo rm -rf /' (sudo prefix, EC-1)", () => {
    expect(catastrophicShellReason("sudo rm -rf /")).toBeTruthy();
  });

  it("allows safe relative 'rm -rf ./build' / 'rm -rf node_modules' (D2)", () => {
    expect(catastrophicShellReason("rm -rf ./build")).toBeNull();
    expect(catastrophicShellReason("rm -rf node_modules")).toBeNull();
  });
});

describe("catastrophicShellReason — pipe into a shell", () => {
  it("blocks 'curl http://x | sh' and 'wget -O- u | bash' (EC-2)", () => {
    expect(catastrophicShellReason("curl http://x | sh")).toBeTruthy();
    expect(catastrophicShellReason("wget -O- u | bash")).toBeTruthy();
  });
});

describe("catastrophicShellReason — device / filesystem destruction", () => {
  it("blocks 'mkfs.ext4 /dev/sda'", () => {
    expect(catastrophicShellReason("mkfs.ext4 /dev/sda")).toBeTruthy();
  });

  it("blocks 'dd if=/dev/zero of=/dev/sda'", () => {
    expect(catastrophicShellReason("dd if=/dev/zero of=/dev/sda")).toBeTruthy();
  });
});

describe("catastrophicShellReason — fork bomb", () => {
  it("blocks ':(){ :|:& };:' despite internal pipe/semicolon (EC-1)", () => {
    expect(catastrophicShellReason(":(){ :|:& };:")).toBeTruthy();
  });
});

describe("catastrophicShellReason — git force push", () => {
  it("blocks 'git push --force' and 'git push -f origin main'", () => {
    expect(catastrophicShellReason("git push --force")).toBeTruthy();
    expect(catastrophicShellReason("git push -f origin main")).toBeTruthy();
  });

  it("allows 'git push --force-with-lease'", () => {
    expect(catastrophicShellReason("git push --force-with-lease")).toBeNull();
  });
});

describe("catastrophicShellReason — chmod recursive on root", () => {
  it("blocks 'chmod -R 777 /'", () => {
    expect(catastrophicShellReason("chmod -R 777 /")).toBeTruthy();
  });
});

describe("catastrophicShellReason — safe commands and mentions", () => {
  it("allows 'ls -la', 'echo hi', 'git status', 'cat f'", () => {
    expect(catastrophicShellReason("ls -la")).toBeNull();
    expect(catastrophicShellReason("echo hi")).toBeNull();
    expect(catastrophicShellReason("git status")).toBeNull();
    expect(catastrophicShellReason("cat f")).toBeNull();
  });

  it("does not over-block a mention 'echo \"rm -rf /\"' (command-position, EC-4)", () => {
    expect(catastrophicShellReason('echo "rm -rf /"')).toBeNull();
  });
});

describe("CatastrophicCommandError", () => {
  it("extends ConfigurationError shape with code 'catastrophic_command'", () => {
    const err = new CatastrophicCommandError("rm -rf of a root path");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CatastrophicCommandError");
    expect((err as { code?: string }).code).toBe("catastrophic_command");
    expect(err.message).toContain("rm -rf of a root path");
  });
});
