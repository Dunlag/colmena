import assert from 'node:assert/strict'
import { mockHost, mountWorker, test } from 'orca/testing'
import { clave, LOCAL } from './datos'
import { LENTA_MS, lector } from './fuentes'
import { CLAVE_MODELOS, type Modelos } from './modelo'
import { activar, eventos, hookModelo } from './worker'

test('El lector ejecuta consultas en serie y continúa tras un fallo de Orca', async () => {
  let enCurso = false
  const llamadas: string[] = []
  let reloj = 0
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
    if (orden === 'agent list') return JSON.stringify({ ok: true, result: { agents: [] } })
    if (orden.startsWith('orchestration worker-list')) return JSON.stringify({ ok: true, result: { workers: [] } })
    if (orden.startsWith('bot item list')) return JSON.stringify({ ok: true, result: { items: [] } })
    if (orden.startsWith('orchestration inbox')) return JSON.stringify({ ok: true, result: { messages: [] } })
    return JSON.stringify({ ok: true, result: { automations: [{ id: 'riego' }] } })
  }, () => reloj)
  const datos = await fuente.otras()
  assert.deepEqual(llamadas, [
    'bot list', 'bot work list --bot Bob', 'automations list', 'bot item list --bot Bob --status done,canceled', 'agent list',
    'bot item list --bot Bob --status needs_you', 'orchestration inbox --limit 100 --full',
    'orchestration worker-list --full',
  ])
  // Dentro de 10 min solo se repite lo rápido (los datos lentos se conservan).
  llamadas.length = 0
  const repetida = await fuente.otras()
  assert.deepEqual(llamadas, [
    'agent list', 'bot item list --bot Bob --status needs_you', 'orchestration inbox --limit 100 --full',
    'orchestration worker-list --full',
  ])
  assert.equal(repetida.automatizaciones?.filas[0].id, 'riego')
  llamadas.length = 0
  reloj = LENTA_MS
  await fuente.otras()
  assert.equal(llamadas.at(0), 'bot list')
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

test('Sin vista visible no sondea la CLI: solo una consulta al abrir y ninguna más', async () => {
  let detener: (() => Promise<void>) | undefined
  let otras = 0
  const host = mockHost({
    capabilities: ['agent:read', 'storage:own', 'workspace:read'],
    results: { 'workspace.list': { workspaces: [], truncated: false } },
  })
  const worker = await mountWorker({
    default: (orca) => {
      detener = activar(orca, () => ({ otras: async () => { otras++; return {} } }) as never)
    },
    deactivate: () => detener?.(),
  }, { events: eventos, hooks: [hookModelo], host })
  try {
    await worker.request('grafo.obtener')
    await new Promise((resolve) => setTimeout(resolve, 100))
    await worker.request('grafo.obtener')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(otras, 1)
    await worker.request('vista.visible', { visible: false })
    assert.equal(otras, 1)
  } finally {
    await detener?.()
  }
})

test('Solo el panel lateral: CLI cada 10 min y al abrir si tiene más de 5 min; con la pestaña, cada 2 min', async () => {
  const { mock } = await import('node:test')
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const manejadores = new Map<string, (entrada: unknown, contexto: unknown) => unknown>()
  const nada = { dispose() {} }
  const orca = {
    panels: { handle: (nombre: string, f: never) => (manejadores.set(nombre, f), nada), post() {} },
    events: { on: () => nada }, commands: { register: () => nada }, hooks: { on: () => nada },
    storage: { get: async () => undefined, set: async () => {} }, log() {}, host: {},
  }
  let otras = 0
  const detener = activar(orca as never, () => ({ otras: async () => { otras++; return {} } }) as never, async () => ({}))
  const vacio = () => new Promise((resolve) => setImmediate(resolve))
  const abiertas = new Set<string>()
  const vista = async (id: string, surface: 'panel' | 'editor', visible: boolean) => {
    if (visible) abiertas.add(id)
    else abiertas.delete(id)
    manejadores.get('vista.visible')!({ visible }, { panel: { id, surface, contributionId: 'colmena' } })
    await vacio()
  }
  // Avanza con el latido de 10 s de cada vista abierta.
  const avanzar = async (ms: number) => {
    for (let hecho = 0; hecho < ms; hecho += 10_000) {
      mock.timers.tick(10_000)
      for (const id of abiertas) await vista(id, id === 'pestana' ? 'editor' : 'panel', true)
      await vacio()
    }
  }
  try {
    await vista('lateral', 'panel', true)
    assert.equal(otras, 1, 'al abrir el panel sin datos')
    await avanzar(590_000)
    assert.equal(otras, 1, 'nada de la ronda de 2 min con solo el panel')
    await avanzar(10_000)
    assert.equal(otras, 2, 'una ronda a los 10 min')
    await vista('lateral', 'panel', false)
    await avanzar(240_000)
    await vista('lateral', 'panel', true)
    assert.equal(otras, 2, 'al reabrir con datos de 4 min no consulta')
    await vista('lateral', 'panel', false)
    await avanzar(70_000)
    await vista('lateral', 'panel', true)
    assert.equal(otras, 3, 'al reabrir con datos de más de 5 min consulta')
    await vista('pestana', 'editor', true)
    await avanzar(120_000)
    assert.equal(otras, 4, 'con la pestaña visible vuelve la ronda de 2 min')
    await vista('pestana', 'editor', false)
    await avanzar(300_000)
    assert.equal(otras, 4)
  } finally {
    mock.timers.reset()
    await detener()
  }
})
