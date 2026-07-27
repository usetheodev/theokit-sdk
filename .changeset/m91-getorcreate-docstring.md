---
'@theokit/sdk': patch
---

Corrige o docstring de `Agent.getOrCreate`, que afirmava o oposto do comportamento real.

Ele dizia: *"Disposed agents are NOT auto-deleted from the registry. To force a fresh agent, call
`Agent.delete(agentId)` first."* Medido, é falso — `dispose()` chama `liveAgentRegistry.forget(id)`,
então o próximo `getOrCreate(id)` constrói um handle novo, sem `Agent.delete`.

A afirmação era sobre o registro **persistente** e foi lida como sendo sobre o **cache vivo**; um
consumidor construiu em cima da metade errada. Travado por `tests/m91-getorcreate-apos-dispose.test.ts`.

O bullet novo também registra o que continua verdadeiro: `close()` marca o handle descartado **sem**
evictar a entrada do cache. É interno e sem chamador hoje; se voltar a ser alcançável, o bullet deixa
de valer para aquele caminho — e está escrito para que a próxima pessoa não precise redescobrir.
