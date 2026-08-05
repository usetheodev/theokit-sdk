/**
 * M93 — H1 and H2 from adversarial review: permissions and a truncated line.
 *
 * As duas nasceram da mesma troca: sair de `replaceFileAtomic` (que reescrevia tudo, com `0o600`)
 * to incremental append. The append is what makes writing linear rather than quadratic — but
 * inherited the umask and lost the self-healing of a file broken by a crash.
 */

import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl } from "../src/internal/persistence/jsonl.js";
import { readTranscript } from "../src/internal/persistence/session-transcript.js";

const dir = (): string => mkdtempSync(join(tmpdir(), "m93-append-"));

describe("M93/H1 — o transcript nasce 0600", () => {
  it("a new file is NOT readable by others, whatever the umask", () => {
    const p = join(dir(), "t.jsonl");
    appendJsonl(p, { a: 1 });
    // 0o077 = qualquer bit de grupo/outros. Sob `umask 022` o append cru dava 0o664 e reprovava.
    expect(statSync(p).mode & 0o077).toBe(0);
  });
});

describe("M93/H2 — appending over a truncated line does not swallow the new record", () => {
  it("the new record stays readable after a crash mid-append", async () => {
    const p = join(dir(), "t.jsonl");
    appendJsonl(p, { type: "user", uuid: "a", parentUuid: null, sessionId: "s", timestamp: "t" });
    // Simulates the crash: half a line, with no trailing `\n`.
    appendFileSync(p, '{"type":"user","uuid":"b","incompl');
    appendJsonl(p, { type: "user", uuid: "c", parentUuid: null, sessionId: "s", timestamp: "t" });

    // `readTranscript` is the store's real reader and skips ANY malformed line — the partial disappears
    // (esperado, ele nunca esteve completo) mas o registro seguinte tem de sobreviver.
    const ids = (await readTranscript(p)).map((r) => r.uuid);
    expect(ids, "o registro novo sumiu junto com o partial").toContain("c");
    expect(ids).toContain("a");
  });

  it("does not insert a spurious break when the file already ends in \\n", () => {
    const p = join(dir(), "t.jsonl");
    writeFileSync(p, '{"id":"a"}\n');
    appendJsonl(p, { id: "b" });
    expect(readFileSync(p, "utf8")).toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  it("an empty file gains no leading break", () => {
    const p = join(dir(), "t.jsonl");
    writeFileSync(p, "");
    appendJsonl(p, { id: "a" });
    expect(readFileSync(p, "utf8")).toBe('{"id":"a"}\n');
  });
});
