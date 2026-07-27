/**
 * `SessionRecord` — the native on-disk transcript record shape (SE40).
 *
 * The theokit session format IS the Claude Code record shape: a
 * `uuid`/`parentUuid` DAG of records with structured
 * `text`/`tool_use`/`tool_result`/`thinking` blocks. This is the contract the
 * pluggable {@link SessionStore} seam operates over.
 *
 * DIP-correct home (SE46): the contract lives in the domain `types/` layer;
 * the application-layer DAG core (`internal/persistence/session-transcript.ts`)
 * re-exports it for back-compat while owning the record builders + reader.
 *
 * @public
 */

/** One transcript record (one JSONL line). `message` absent on `system` (compact_boundary) records. */
/** Um bloco de conteúdo dentro de {@link TranscriptMessage}. */
export type TranscriptBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean };

/**
 * O corpo de mensagem de um {@link SessionRecord}.
 *
 * **NÃO se chama `SessionMessage`** — esse nome já existe em `internal/session/session-types.ts` com
 * a forma `{role, text}`, incompatível com esta. Repropor um nome exportado com forma nova é
 * precisamente a quebra silenciosa que o M91 custou dois patches para desfazer.
 *
 * O parse do disco continua **tolerante** (`readTranscript` pula linha malformada): o que muda aqui
 * é o **tipo**, não a leniência — registros gravados por versões anteriores continuam legíveis.
 *
 * @public
 */
export interface TranscriptMessage {
  role: "user" | "assistant";
  content: TranscriptBlock[];
  /**
   * Os três campos abaixo aparecem **só** no registro de assistant, e vêm do escritor
   * (`SessionTranscript.appendAssistant`). Declarados opcionais porque o registro de user não os
   * tem — medido no próprio escritor, não presumido.
   */
  id?: string;
  type?: "message";
  model?: string;
}

export interface SessionRecord {
  type: "user" | "assistant" | "system";
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  version?: string;
  subtype?: string;
  compactMetadata?: { preTokens: number; trigger: string };
  /**
   * O corpo da mensagem, na forma que o escritor de transcript de fato grava.
   *
   * M94 — era `Record<string, unknown>`, e o consumidor recuperava o tipo com cast a cada leitura.
   * A forma **sempre foi fixa** (`SessionTranscript.appendToolResults` / `#push` a produzem); só não
   * estava declarada. Segue opcional porque registros de sistema não carregam mensagem.
   */
  message?: TranscriptMessage;
}
