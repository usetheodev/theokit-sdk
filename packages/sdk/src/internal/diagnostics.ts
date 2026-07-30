/**
 * Canal único de diagnóstico da biblioteca — silencioso por padrão (#147).
 *
 * ## O problema
 *
 * O SDK escrevia diagnósticos direto em `process.stderr` a partir de caminhos quentes —
 * 92 sítios em 51 arquivos sob `internal/`. Numa host de TUI (Ink, alternate screen), essas
 * escritas se intercalam com o render e **corrompem o frame**. E o host não tinha como
 * interceptá-las: não havia logger injetável. Um consumidor chegou a instalar
 * `proper-lockfile` só para calar UMA delas.
 *
 * Uma biblioteca não pode assumir que `stdout`/`stderr` são sinks livres. Quem é dono do
 * terminal é a aplicação, não a dependência.
 *
 * ## O contrato
 *
 * - **`setDiagnosticsSink(fn)`** entrega as mensagens à aplicação, que decide onde colocá-las
 *   (uma linha de status, um arquivo, um painel). É o que faltava para uma TUI conviver com o SDK.
 * - **Sem sink, vai para o `stderr`** — exatamente como antes desta mudança.
 *
 * ## Por que o padrão NÃO mudou (ainda), e isso é deliberado
 *
 * A #147 pede silêncio por padrão, e é o alvo certo. Mas **58 arquivos de teste** asseram hoje
 * que estes diagnósticos chegam ao `stderr` — eles codificam o contrato "o aviso É emitido", que
 * continua valendo e não deve ser perdido. Virar o padrão sem migrá-los reprovaria ~53 testes, e
 * migrá-los às pressas, em quatro formas diferentes de espionar o `stderr`, é a receita para
 * enfraquecer 58 suítes de uma vez.
 *
 * Então esta mudança entrega a metade que DESTRAVA o consumidor — o host de TUI agora consegue
 * interceptar, que era o bloqueio relatado ("no way to intercept these; no injectable logger") — e
 * deixa a virada do padrão como migração própria, com custo medido. Um host que quer silêncio
 * hoje instala `setDiagnosticsSink(() => {})`.
 *
 * ## O que isto NÃO é
 *
 * Não é um logger com níveis, formatação ou destinos múltiplos. É o mínimo que resolve o
 * bloqueio relatado; um logger completo aqui seria inventar requisito que ninguém pediu.
 */

/** Recebe cada mensagem de diagnóstico já formatada, com o `\n` final. */
export type DiagnosticsSink = (message: string) => void;

let sink: DiagnosticsSink | undefined;

/**
 * Instala (ou remove, passando `undefined`) o destino dos diagnósticos.
 *
 * Quando há sink, ele é o ÚNICO destino — o `stderr` não recebe cópia. Duplicar destinos
 * devolveria o problema à TUI que instalou o sink justamente para tirar as mensagens do terminal.
 */
export function setDiagnosticsSink(next: DiagnosticsSink | undefined): void {
  sink = next;
}

/**
 * Emite uma mensagem de diagnóstico da biblioteca.
 *
 * Substitui `process.stderr.write` nos caminhos internos. Nunca lança: um sink defeituoso não
 * pode derrubar o run que ele apenas observa.
 */
export function diag(message: string): void {
  if (sink !== undefined) {
    try {
      sink(message);
    } catch {
      // Observabilidade nunca quebra o run — mesmo princípio de `emitRunEvent`.
    }
    return;
  }
  process.stderr.write(message);
}
