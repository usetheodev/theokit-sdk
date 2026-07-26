/**
 * M75 T3.1 — o PTY aceita uma função de wrap injetada, em vez de exigir herança.
 *
 * ## O que existia e por que trocou
 *
 * O agent-builder tinha `SandboxedInteractiveBackend extends PtyInteractiveBackend`, 99 linhas cujo
 * `override startInteractive` reescrevia o método **inteiro** — só para transformar uma string. Por
 * viver ali, o override foi acumulando o que não é dele: a detecção do bwrap, o WARN-once e o default
 * de `cwd`. Cada evolução do PTY (um campo novo em `StartInteractiveOptions`, uma mudança de
 * assinatura) obrigava a subclasse a acompanhar.
 *
 * Uma função é o contrato mínimo (ISP): o PTY continua dono do spawn, o sandbox continua dono da
 * política, e nenhum dos dois precisa conhecer o tipo do outro. É o que permite
 * `createInteractiveShellTool({ interactive, sandbox })` compor de verdade.
 *
 * ## Por que `string | null` e não `string`
 *
 * `null` significa **não embrulhe** — o caso `danger-full-access`, que é opt-out explícito. Devolver o
 * comando cru confundiria "decidi não confinar" com "confinei e o resultado é idêntico"; e um
 * chamador que quisesse auditar a decisão não teria como distinguir.
 */
import { describe, expect, it } from "vitest";

import { PtyInteractiveBackend } from "../src/pty-interactive-backend.js";

/**
 * Captura o comando que CHEGA ao `pty.spawn`, sem tocar num PTY real.
 *
 * A primeira versão deste helper substituía `spawnPty` inteiro — e por isso o wrap, que vive DENTRO
 * dele, nunca rodava: o teste media a própria fixture e falhava por construção. Interceptar o módulo
 * `node-pty` mede o caminho real (`startInteractive` → `spawnPty` → wrap → `pty.spawn`), que é a
 * única coisa que prova a ligação.
 */
const capturaComandoSpawnado = (backend: PtyInteractiveBackend): string[] => {
  const vistos: string[] = [];
  const alvo = backend as unknown as { ptyModule: unknown };
  alvo.ptyModule = {
    spawn: (_shell: string, args: string[]) => {
      vistos.push(args[1] ?? "");
      throw new Error("spawn interceptado — o comando já foi capturado");
    },
  };
  return vistos;
};

describe("M75 T3.1 — wrapCommand injetado no PtyInteractiveBackend", () => {
  it("test_wrap_e_aplicado_antes_do_spawn", async () => {
    const b = new PtyInteractiveBackend({ wrapCommand: (cmd) => `EMBRULHADO:${cmd}` });
    const vistos = capturaComandoSpawnado(b);
    await b.startInteractive("echo oi").catch(() => undefined);
    expect(vistos[0], "o comando chegou ao spawn sem passar pelo wrap").toBe("EMBRULHADO:echo oi");
  });

  it("test_wrap_recebe_o_cwd_resolvido_nao_o_bruto", async () => {
    // O PTY spawna NESTE cwd; o wrap tem de mirar o MESMO diretório, senão os binds do bwrap
    // apontariam para um lugar e o processo rodaria em outro — confinamento que não confina nada.
    const cwds: string[] = [];
    const b = new PtyInteractiveBackend({
      wrapCommand: (cmd, cwd) => {
        cwds.push(cwd);
        return cmd;
      },
    });
    capturaComandoSpawnado(b);
    await b.startInteractive("true", { cwd: "/tmp" }).catch(() => undefined);
    expect(cwds[0]).toBe("/tmp");
  });

  it("test_null_significa_nao_embrulhe", async () => {
    const b = new PtyInteractiveBackend({ wrapCommand: () => null });
    const vistos = capturaComandoSpawnado(b);
    await b.startInteractive("echo oi").catch(() => undefined);
    expect(vistos[0], "null deve deixar o comando exatamente como veio").toBe("echo oi");
  });

  it("test_sem_a_opcao_o_comportamento_e_o_de_hoje", async () => {
    // Retrocompatibilidade: a mudança é ADITIVA. Todo consumidor que já constrói o backend sem
    // opções continua idêntico — é isso que permite publicar como minor.
    const b = new PtyInteractiveBackend();
    const vistos = capturaComandoSpawnado(b);
    await b.startInteractive("echo oi").catch(() => undefined);
    expect(vistos[0]).toBe("echo oi");
  });
});
