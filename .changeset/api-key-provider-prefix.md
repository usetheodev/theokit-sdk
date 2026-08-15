---
"@theokit/sdk": minor
---

**`providerFromApiKeyPrefix` fica alcancavel a partir de `@theokit/sdk/auth`.**

A pergunta "de qual provider e esta chave?" ja era respondida aqui — em
`internal/local-agent/real-local-run-provider.ts`, marcada `@internal` e exportada por
nenhuma entry. Um consumidor medido precisa dela no login (`opts.provider ?? inferProvider(key)`),
nao conseguiu importar, e escreveu a propria copia. Uma capacidade que existe e nao se alcanca
custa exatamente o que uma ausente custa.

Duas coisas separam isto de um re-export:

1. **O prefixo mais longo vence, por construcao.** A versao interna percorria um array escrito a
   mao e so estava correta porque `sk-or-` e `sk-ant-` calharam de vir antes de `sk-`. Ordem como
   convencao quebra na primeira vez que alguem acrescenta um prefixo mais longo ou ordena a lista
   por legibilidade — em silencio, resolvendo uma chave Anthropic como OpenAI. A ordenacao agora e
   derivada do comprimento.
2. **Sem o gate de perfil de provider.** Esse gate pertence ao caminho de local-run, que nao vai
   nomear um provider que nao consegue construir. Quem pergunta "de quem e esta chave?" no login
   ainda nao tem perfil registrado, e devolver `undefined` ali responderia outra pergunta.

A tabela de prefixos deixa de existir em duas copias: `inferProviderFromApiKey` passa a delegar e
mantem so o que e politica dele.
