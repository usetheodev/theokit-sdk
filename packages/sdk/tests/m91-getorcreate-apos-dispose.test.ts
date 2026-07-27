import { describe, expect, it } from 'vitest'
import { Agent } from '../src/agent.js'

/**
 * M91 — o docstring de `getOrCreate` afirmava o oposto do comportamento real.
 *
 * Ele dizia: *"Disposed agents are NOT auto-deleted from the registry. To force a fresh agent, call
 * `Agent.delete(agentId)` first."* Medido, é falso: `dispose()` chama `liveAgentRegistry.forget(id)`,
 * então o próximo `getOrCreate(id)` constrói um handle novo.
 *
 * A afirmação era sobre o registro PERSISTENTE e foi lida como sendo sobre o cache vivo — e consumidores
 * construíram em cima da metade errada. O agent-builder rotaciona o id de sessão na interrupção do M85
 * para contornar uma restrição que não existe.
 *
 * Este arquivo existe para que a correção do docstring não volte a divergir do código.
 */
describe('M91 — getOrCreate depois de dispose', () => {
  const opts = { apiKey: 'sk-test', model: { id: 'openai/gpt-4o-mini' }, local: { cwd: process.cwd() } }

  it('cache-hit VIVO devolve a mesma instancia', async () => {
    const a = await Agent.getOrCreate('m91-vivo', opts as never)
    const b = await Agent.getOrCreate('m91-vivo', opts as never)
    expect(b).toBe(a)
    await a.dispose()
  })

  it('depois de dispose, getOrCreate devolve instancia NOVA — sem Agent.delete manual', async () => {
    const a = await Agent.getOrCreate('m91-disp', opts as never)
    await a.dispose()
    const b = await Agent.getOrCreate('m91-disp', opts as never)
    expect(b).not.toBe(a)
    await b.dispose()
  })
})
