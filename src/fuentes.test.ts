import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'orca/testing'
import { clave, LOCAL, maquinaRemota, type Captura } from './datos'
import { lector } from './fuentes'
import { normalizar } from './normalizar'
import { textos } from './textos'

const AHORA = 1795608000000

function fixture(nombre: string) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${nombre}.json`, import.meta.url), 'utf8'))
}

function lectorDeEjemplo(caido?: string) {
  const maquinas = fixture('maquinas')
  const llamadas: string[][] = []
  const locales: Record<string, string> = {
    'orchestration worker-list': 'workers',
    'bot list': 'bots', 'bot work': 'trabajos', 'bot item': 'pendientes',
    'orchestration inbox': 'mensajes', 'automations list': 'automatizaciones',
  }
  let enCurso = false
  const fuentes = lector(new AbortController().signal, async (argumentos) => {
    assert.equal(enCurso, false)
    enCurso = true
    await Promise.resolve()
    enCurso = false
    llamadas.push(argumentos)
    const orden = argumentos.slice(0, 2).join(' ')
    const indice = argumentos.indexOf('--environment')
    assert.equal(argumentos.at(-1), '--json')
    if (orden === 'environment list') {
      assert.equal(indice, -1)
      return JSON.stringify(maquinas[orden])
    }
    assert.ok(indice >= 0)
    const servidor = argumentos[indice + 1]
    if (servidor === caido) throw Object.assign(new Error('timeout'), { killed: true })
    const vacias: Record<string, unknown> = {
      'agent list': { agents: [] }, 'orchestration task-list': { tasks: [] }, 'orchestration dispatch-show': { dispatch: {} },
    }
    const respuesta = maquinas[servidor]?.[orden] ?? (
      orden in vacias ? { ok: true, result: vacias[orden] } : fixture(locales[orden])
    )
    if (orden === 'bot list' && servidor === LOCAL) {
      respuesta.result.bots.push({
        ...maquinas.chopper[orden].result.bots[0], server: { name: 'Chopper', on: 'chopper' },
      })
      if (caido === 'deck') respuesta.result.unreachable = [{ name: 'Deck', on: 'deck' }]
    }
    return JSON.stringify(respuesta)
  })
  return { fuentes, llamadas }
}

// Lo vivo llega por la API del host, no por la CLI; aquí lo aportan los fixtures.
async function conVivas(otras: Captura): Promise<Captura> {
  const maquinas = fixture('maquinas')
  return {
    ...otras,
    worktrees: { filas: fixture('worktrees').result.worktrees },
    remotasVivas: Object.fromEntries(['deck', 'chopper'].map((id) => [id, {
      worktrees: { filas: maquinas[id]['worktree ps'].result.worktrees },
    }])),
  }
}

test('Consulta tres máquinas en serie y agrupa bots y workers con ids repetidos', async () => {
  const { fuentes, llamadas } = lectorDeEjemplo()
  const captura = await conVivas(await fuentes.otras())
  // Cada máquina se consulta entera antes de pasar a la siguiente, siempre de una en una.
  const hosts = llamadas.slice(1).map((args) => args[args.indexOf('--environment') + 1])
  assert.deepEqual([...new Set(hosts)], [LOCAL, 'deck', 'chopper'])
  assert.deepEqual(hosts, [...hosts].sort((a, b) => [LOCAL, 'deck', 'chopper'].indexOf(a) - [LOCAL, 'deck', 'chopper'].indexOf(b)))
  const deck = maquinaRemota('deck')
  const chopper = maquinaRemota('chopper')
  captura.automatizaciones?.filas.push({ id: 'solo-local', name: 'Revisar Deck', executionTargetId: deck })
  const grafo = normalizar(captura, AHORA, {
    [clave(deck, 'term_a')]: { agente: 'codex', modelo: 'modelo-deck', maquina: deck, desde: AHORA - 5000 },
  })
  assert.deepEqual(grafo.fallos, [])
  assert.equal(new Set(grafo.nodos.map(({ id }) => id)).size, grafo.nodos.length)
  const auto = grafo.nodos.find((nodo) => nodo.tipo === 'automatizacion' && nodo.nombre === 'Revisar Deck')
  assert.ok(auto && grafo.aristas.some((a) => a.origen === `maquina:${deck}` && a.destino === auto.id))
  for (const [maquina, nombre] of [[LOCAL, textos.local], [deck, 'Deck'], [chopper, 'Chopper']]) {
    const nodo = grafo.nodos.find((n) => n.id === `maquina:${maquina}`)
    const bot = grafo.nodos.find((n) => n.tipo === 'bot' && n.maquina === maquina && n.nombre === 'Huerto')
    const workers = grafo.nodos.filter((n) => n.tipo === 'worker' && n.maquina === maquina && !n.atenuado)
    assert.equal(nodo?.nombre, nombre)
    assert.ok(nodo)
    assert.ok(bot)
    assert.equal(workers.length, 1)
    assert.equal(workers[0].modelo, maquina === deck ? 'modelo-deck' : undefined)
    for (const miembro of [bot, workers[0]]) {
      assert.ok(grafo.aristas.some((a) => a.tipo === 'agrupa' && a.origen === nodo.id && a.destino === miembro.id))
    }
    assert.ok(grafo.aristas.some((a) => a.tipo === 'lanzamiento' && a.origen === bot.id && a.destino === workers[0].id))
  }
})

test('Registra los fallos de una máquina caída y sigue consultando las demás', async () => {
  const { fuentes } = lectorDeEjemplo('deck')
  const datos = await conVivas(await fuentes.otras())
  delete datos.remotasVivas?.deck
  const grafo = normalizar(datos, AHORA)
  assert.ok(grafo.fallos.length > 0)
  assert.ok(grafo.fallos.every((fallo) => fallo.codigo === 'timeout' && fallo.maquina === 'runtime:deck'))
  assert.equal(grafo.nodos.find((nodo) => nodo.id === 'maquina:runtime:deck')?.estado, textos.noDisponible)
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'worker' && nodo.maquina === LOCAL))
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'bot' && nodo.maquina === LOCAL))
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'worker' && nodo.maquina === 'runtime:chopper'))
})
