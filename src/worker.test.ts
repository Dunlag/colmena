import assert from 'node:assert/strict'
import { mockHost, mountWorker, test } from 'orca/testing'
import { clave, LOCAL } from './datos'
import { lector } from './fuentes'
import { CLAVE_MODELOS, type Modelos } from './modelo'
import { activar, eventos, hookModelo } from './worker'

test('El lector ejecuta consultas en serie y continúa tras un fallo de Orca', async () => {
  let enCurso = false
  const llamadas: string[] = []
  const fuente = lector(new AbortController().signal, async (args) => {
    assert.equal(enCurso, false)
    enCurso = true
    await Promise.resolve()
    enCurso = false
    assert.deepEqual(args.slice(-3), ['--environment', LOCAL, '--json'])
    const orden = args.slice(0, -3).join(' ')
    llamadas.push(orden)
    assert.equal(args.at(-1), '--json')
    if (orden === 'bot list') return JSON.stringify({ ok: true, result: { bots: [{ name: 'Bob' }] } })
    if (orden.startsWith('bot work list')) return JSON.stringify({ ok: false, error: { code: 'ejemplo' } })
    if (orden.startsWith('bot item list')) return JSON.stringify({ ok: true, result: { items: [] } })
    if (orden.startsWith('orchestration inbox')) return JSON.stringify({ ok: true, result: { messages: [] } })
    return JSON.stringify({ ok: true, result: { automations: [{ id: 'riego' }] } })
  })
  const datos = await fuente.otras()
  assert.deepEqual(llamadas, [
    'bot list', 'bot work list --bot Bob', 'bot item list --bot Bob --status needs_you',
    'orchestration inbox --full', 'automations list',
  ])
  assert.equal(datos.trabajos?.Bob.fallo?.codigo, 'ejemplo')
  assert.equal(datos.automatizaciones?.filas[0].id, 'riego')
})

test('El worker devuelve el grafo al panel y observa arranques sin modificar el lanzamiento', async () => {
  let detener: (() => Promise<void>) | undefined
  const host = mockHost({ capabilities: ['agent:read', 'storage:own', 'workspace:read'] })
  const worker = await mountWorker({
    default: (orca) => {
      detener = activar(orca, () => ({
        vivas: async () => ({}),
        otras: async () => ({}),
      }))
    },
    deactivate: () => detener?.(),
  }, { events: eventos, hooks: [hookModelo], host })
  try {
    const grafo = await worker.request('grafo.obtener')
    assert.equal(grafo.nodos[0].tipo, 'tu')
    assert.ok(Number.isFinite(grafo.generado))
    const arranque = {
      agent: 'codex', workspaceId: null, workspaceKind: null, terminalId: 'term_a',
      command: 'API_KEY=oculta codex --model "gpt-ejemplo" --prompt "mensaje privado"',
      env: { TOKEN: 'otro secreto' },
    }
    const otro = { ...arranque, terminalId: 'term_b', command: 'codex' }
    const sinTerminal = { ...otro, terminalId: undefined }
    for (const lanzamiento of [arranque, otro, sinTerminal]) {
      assert.deepEqual(await worker.hooks.fire(hookModelo, lanzamiento), {
        kind: 'continue', event: lanzamiento,
      })
    }
    await worker.deactivate()
    const guardado = host.data().storage[CLAVE_MODELOS] as Modelos
    assert.deepEqual(Object.keys(guardado).sort(), [clave(LOCAL, 'term_a'), clave(LOCAL, 'term_b')])
    for (const [terminal, esperado] of [['term_a', 'gpt-ejemplo'], ['term_b', null]] as const) {
      const registro = guardado[clave(LOCAL, terminal)]
      assert.ok(Number.isFinite(registro.desde))
      assert.deepEqual(registro, { agente: 'codex', modelo: esperado, maquina: LOCAL, desde: registro.desde })
    }
    assert.deepEqual(worker.refusals, [])
  } finally {
    await detener?.()
  }
})
