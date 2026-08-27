---
"@theokit/sdk-budget": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-memory": patch
---

Os peer ranges deixam de prometer versões do `@theokit/sdk` em que os pacotes não compilam.

Os três declaravam `>=4.0.0`. `4.0.1` é a menor versão publicada que esse range admite — o que um
consumidor que fixa conservadoramente, ou que resolve sob uma restrição transitiva mais antiga,
recebe. O npm resolve essa combinação sem `ERESOLVE` e sem aviso de peer, e o build quebra depois,
em `TS2552: Cannot find name` e `TS2305: has no exported member`.

Os pisos foram medidos por bissecção sobre as 116 versões 4.x estáveis, com build real como
oráculo — e cada um tem a versão imediatamente anterior falhando, então é a versão exata, não um
intervalo:

| pacote | piso | prova |
|---|---|---|
| `@theokit/sdk-budget` | `>=4.54.0` | `4.53.1` falha, `4.54.0` passa |
| `@theokit/sdk-handoff` | `>=4.54.0` | `4.53.1` falha, `4.54.0` passa |
| `@theokit/sdk-memory` | `>=4.53.1` | `4.53.0` falha, `4.53.1` passa |

O `sdk-memory` tem piso próprio, uma release abaixo dos outros dois: não é uma migração
compartilhada, cada pacote derivou para longe do piso declarado por conta própria.

O oráculo apaga todo `dist/` antes de construir. Sem isso o build lê o `dist` do irmão construído
contra outra versão, e é assim que um pacote "passa" contra um SDK que não tem os símbolos — o modo
de falha que fez a medição anterior discordar do CI (usetheokit/theokit-sdk#423).
