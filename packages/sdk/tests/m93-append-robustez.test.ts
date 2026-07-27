/**
 * M93 — H1 e H2 da revisão adversarial: permissão e linha truncada.
 *
 * As duas nasceram da mesma troca: sair de `replaceFileAtomic` (que reescrevia tudo, com `0o600`)
 * para append incremental. O append é o que torna a gravação linear em vez de quadrática — mas
 * herdou o umask e perdeu a auto-cura de um arquivo partido por crash.
 */

import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl } from "../src/internal/persistence/jsonl.js";
import { readTranscript } from "../src/internal/persistence/session-transcript.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "m93-append-"));

describe("M93/H1 — o transcript nasce 0600", () => {
  it("um arquivo novo NÃO é legível por outros, qualquer que seja o umask", () => {
    const p = join(dir(), "t.jsonl");
    appendJsonl(p, { a: 1 });
    // 0o077 = qualquer bit de grupo/outros. Sob `umask 022` o append cru dava 0o664 e reprovava.
    expect(statSync(p).mode & 0o077).toBe(0);
  });
});

describe("M93/H2 — append sobre linha truncada não engole o registro novo", () => {
  it("o registro novo continua legível depois de um crash no meio de um append", async () => {
    const p = join(dir(), "t.jsonl");
    appendJsonl(p, { type: "user", uuid: "a", parentUuid: null, sessionId: "s", timestamp: "t" });
    // Simula o crash: meia linha, sem `\n` final.
    appendFileSync(p, '{"type":"user","uuid":"b","incompl');
    appendJsonl(p, { type: "user", uuid: "c", parentUuid: null, sessionId: "s", timestamp: "t" });

    // `readTranscript` é o leitor real do store e pula QUALQUER linha malformada — o parcial some
    // (esperado, ele nunca esteve completo) mas o registro seguinte tem de sobreviver.
    const ids = (await readTranscript(p)).map((r) => r.uuid);
    expect(ids, "o registro novo sumiu junto com o parcial").toContain("c");
    expect(ids).toContain("a");
  });

  it("não insere quebra espúria quando o arquivo já termina em \\n", () => {
    const p = join(dir(), "t.jsonl");
    writeFileSync(p, '{"id":"a"}\n');
    appendJsonl(p, { id: "b" });
    expect(readFileSync(p, "utf8")).toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  it("arquivo vazio não ganha quebra inicial", () => {
    const p = join(dir(), "t.jsonl");
    writeFileSync(p, "");
    appendJsonl(p, { id: "a" });
    expect(readFileSync(p, "utf8")).toBe('{"id":"a"}\n');
  });
});
