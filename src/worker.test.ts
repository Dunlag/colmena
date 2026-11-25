import assert from 'node:assert/strict'
import { mountWorker, test } from 'orca/testing'
import { lector } from './fuentes'
import { activar, eventos } from './worker'

test('El lector ejecuta consultas en serie y continúa tras un fallo de Orca', async () => {
  let enCurso = false
  const llamadas: string[] = []
  const fuente = lector(new AbortController().signal, async (args) => {
    assert.equal(enCurso, false)
    enCurso = true
    await Promise.resolve()
    enCurso = false
    const orden = args.slice(0, -1).join(' ')
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

test('El worker devuelve un grafo en el request del panel', async () => {
  let detener: (() => void) | undefined
  const worker = await mountWorker({
    default: (orca) => {
      detener = activar(orca, () => ({
        vivas: async () => ({}),
        otras: async () => ({}),
      }))
    },
    deactivate: () => detener?.(),
  }, { events: eventos })
  try {
    const grafo = await worker.request('grafo.obtener')
    assert.equal(grafo.nodos[0].tipo, 'tu')
    assert.ok(Number.isFinite(grafo.generado))
  } finally {
    await worker.deactivate()
  }
})
