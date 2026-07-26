/**
 * O marcador de continuação do goal-loop — num módulo FOLHA, de propósito.
 *
 * Ele vivia em `goal-loop.ts` e era importado por `run-until.ts`, que o `goal-loop` por sua vez
 * importa de volta. O ciclo estava quebrado em runtime (a volta é `import type` + `await import()`
 * dinâmico), mas o detector de ciclos conta a aresta dinâmica — e contar import dinâmico como ciclo
 * torna o gate impossível de satisfazer sem abandonar a técnica canônica de quebrar ciclos.
 *
 * Uma constante compartilhada por dois módulos que se conhecem é o caso-escola de extração para
 * folha: ninguém precisa importar o outro para conhecê-la. Some o ciclo em QUALQUER detector, sem
 * política de ferramenta e sem mudar uma linha de comportamento.
 */
export const GOAL_CONTINUATION_MARKER = "[[theokit:goal-continuation]]";
