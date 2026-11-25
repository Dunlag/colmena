import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { normalizar } from './normalizar'
import { capturaEjemplo as captura } from './ejemplo'
import { clave, LOCAL, type Fila } from './datos'
import { textos } from './textos'

const AHORA = 1795608000000
const FIN = Date.parse('2026-11-25T10:00:00.000Z')
const DIA_MS = 86_400_000

test('Une observaciones por id y conserva el lanzador y la hora del mensaje', () => {
  const datos = captura()
  datos.bots!.filas.push(...datos.bots!.filas)
  datos.workers!.filas.push(...datos.workers!.filas)
  const grafo = normalizar(datos, AHORA)
  assert.equal(grafo.nodos.filter((nodo) => nodo.tipo === 'bot').length, 2)
  assert.equal(grafo.nodos.filter((nodo) => nodo.tipo === 'worker').length, 2)
  const vivo = grafo.nodos.find((nodo) => nodo.tarea === 'Revisar el huerto')!
  assert.ok(vivo)
  assert.equal(vivo.estado, textos.enCurso)
  assert.deepEqual(vivo.destino, { terminalId: 'term_a', workspaceId: 'taller' })
  assert.equal(grafo.aristas.filter((a) => a.tipo === 'lanzamiento' && a.destino === vivo.id).length, 1)
  assert.ok(grafo.aristas.some((a) =>
    a.tipo === 'lanzamiento' && a.origen === 'bot:bot-2' && a.destino === vivo.id))
  assert.ok(grafo.aristas.some((a) =>
    a.tipo === 'mensaje' && a.origen === 'bot:bob-1' && a.destino === vivo.id &&
    a.hora === Date.parse('2026-11-25T10:01:00.000Z')))
  assert.equal(grafo.nodos.find((nodo) => nodo.tipo === 'tu')?.pendientes?.[0].tarea, 'Confirmar la fecha')
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'automatizacion' && nodo.nombre === 'Riego'))
  assert.ok(grafo.aristas.some((a) => a.origen === 'maquina:local' && a.destino === vivo.id))
})

test('Un workspace vacío en dos fuentes no crea un worker', () => {
  const datos = captura()
  datos.worktrees!.filas = datos.worktrees!.filas.slice(1)
  datos.workers = undefined
  assert.ok(normalizar(datos, AHORA).nodos.every((nodo) => nodo.tipo !== 'worker'))
})

test('Atenúa al terminar y caduca exactamente a las 24 horas', () => {
  const datos = captura()
  const antes = normalizar(datos, FIN + DIA_MS - 1)
  const atenuado = antes.nodos.find((nodo) => nodo.modelo === 'modelo-de-ejemplo')
  assert.equal(atenuado?.atenuado, true)
  assert.equal(atenuado?.desde, FIN)

  const despues = normalizar(datos, FIN + DIA_MS)
  assert.ok(despues.nodos.every((nodo) => nodo.id !== atenuado?.id))
  assert.ok(despues.aristas.every((arista) => arista.destino !== atenuado?.id && arista.origen !== atenuado?.id))
})

test('Conserva el tipo de agente cuando Orca no informa el modelo', () => {
  const vivo = normalizar(captura(), AHORA).nodos.find((nodo) => nodo.tarea === 'Revisar el huerto')
  assert.equal(vivo?.agente, 'codex')
  assert.equal(Object.hasOwn(vivo!, 'modelo'), false)
})

test('Una fuente fallida queda anotada sin ocultar otras fuentes', () => {
  const datos = captura()
  const fallo = { maquina: LOCAL, fuente: 'automations list', codigo: 'timeout', mensaje: textos.tiempoAgotado }
  datos.automatizaciones = { filas: [], fallo }
  const grafo = normalizar(datos, AHORA)
  assert.deepEqual(grafo.fallos, [fallo])
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'worker'))
  assert.ok(grafo.nodos.some((nodo) => nodo.tipo === 'bot'))
  assert.ok(grafo.nodos.every((nodo) => nodo.tipo !== 'automatizacion'))
})

test('Dos máquinas pueden devolver el mismo handle sin fusionar sus workers', () => {
  const datos = captura()
  const vivo = datos.workers!.filas[0]
  datos.workers!.filas.push({
    ...vivo,
    projection: { ...(vivo.projection as Fila), host: { id: 'remota', kind: 'server' } },
  })
  const grafo = normalizar(datos, AHORA)
  assert.equal(grafo.nodos.filter((nodo) => nodo.tipo === 'worker' && !nodo.atenuado).length, 2)
  assert.ok(grafo.nodos.some((nodo) => nodo.id === 'maquina:remota'))
})

test('Aplica el modelo guardado a un worker encontrado por el panel de su terminal', () => {
  const datos = captura()
  datos.workers = undefined
  datos.terminales = { filas: [{ handle: 'term_a', tabId: 'tab-a', leafId: 'panel-a', executionHostId: LOCAL }] }
  const registro = { agente: 'codex', modelo: 'gpt-ejemplo', maquina: LOCAL, desde: AHORA - 5000 }
  const llave = clave(LOCAL, 'term_a')
  const remoto = { ...registro, maquina: 'runtime:deck', modelo: 'otro-modelo' }
  const modelos = { [llave]: registro, [clave(remoto.maquina, 'term_a')]: remoto }
  const worker = normalizar(datos, AHORA, modelos).nodos.find((nodo) => nodo.tipo === 'worker')
  assert.equal(worker?.modelo, 'gpt-ejemplo')
  const caducado = normalizar(datos, registro.desde + DIA_MS, modelos).nodos.find((nodo) => nodo.tipo === 'worker')
  assert.equal(caducado?.agente, 'codex')
  assert.equal(caducado?.modelo, undefined)
})
