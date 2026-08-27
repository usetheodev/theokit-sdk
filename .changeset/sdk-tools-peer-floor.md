---
"@theokit/sdk-tools": patch
---

O peer range do `@theokit/sdk` deixa de prometer uma versão em que o pacote não compila.

Declarava `>=4.19.3` e falha exatamente nesse piso, com `error TS2552: Cannot find name`. O npm
resolve a combinação sem `ERESOLVE` e sem aviso de peer, e a quebra aparece no build, longe do range
que a causou.

O piso real é `4.54.0`, medido por bissecção sobre as 116 versões 4.x estáveis com build real como
oráculo: `4.53.1` falha e `4.54.0` passa. São adjacentes na lista publicada, então é a versão exata,
não um intervalo.

Este pacote tinha sido excluído do achado irmão (usetheokit/theokit-sdk#423) por declarar um range
mais estreito que os outros quatro. Um range mais estreito ainda pode ser falso — é só falso sobre
um intervalo menor (usetheokit/theokit-sdk#425).
