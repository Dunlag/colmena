import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import type { Arista, Grafo, Nodo } from './normalizar'
import { normalizar } from './normalizar'
import { textos } from './textos'
import { activosPorBot, atascos, cuentaAtras, destinoItem, medianoche, proximas, resumenDia } from './torre'

const MIN = 60_000
// 26/11 a las 10:00 locales; la medianoche es el corte del día.
const AHORA = new Date(2026, 10, 26, 10, 0).getTime()

function nodo(parcial: Partial<Nodo> & Pick<Nodo, 'id' | 'tipo'>): Nodo {
  return { nombre: parcial.id, estado: textos.enCurso, situacion: 'trabajando', maquina: 'local',
    tarea: null, desde: null, ...parcial }
}

function grafo(nodos: Nodo[], aristas: Arista[] = [], cierres: number[] = []): Grafo {
  return { nodos, aristas, cierres, generado: AHORA, fallos: [], recuento: { nodos: 0, conexiones: 0 } }
}

test('Atascos: espera de permiso, más de N min sin cambio y fallados de hoy', () => {
  const g = grafo([
    nodo({ id: 'permiso', tipo: 'worker', estado: textos.bloqueado, situacion: 'esperando', desde: AHORA - MIN }),
    nodo({ id: 'parado', tipo: 'worker', desde: AHORA - 21 * MIN }),
    nodo({ id: 'reciente', tipo: 'worker', desde: AHORA - 19 * MIN }),
    nodo({ id: 'fallado', tipo: 'worker', estado: textos.fallido, situacion: 'terminado', desde: AHORA - 60 * MIN }),
    nodo({ id: 'fallado-ayer', tipo: 'worker', estado: textos.fallido, situacion: 'terminado',
      desde: medianoche(AHORA) - MIN }),
    nodo({ id: 'hecho', tipo: 'worker', estado: textos.finalizado, situacion: 'terminado', desde: AHORA - 90 * MIN }),
    nodo({ id: 'bot', tipo: 'bot', desde: AHORA - 90 * MIN }),
  ])
  assert.deepEqual(atascos(g, AHORA).map(({ nodo, motivo }) => [nodo.id, motivo]),
    [['permiso', 'permiso'], ['parado', 'parado'], ['fallado', 'fallado']])
  // El umbral es ajustable.
  assert.deepEqual(atascos(g, AHORA, 10).map(({ nodo }) => nodo.id), ['permiso', 'parado', 'reciente', 'fallado'])
})

test('Resumen del día: solo cuenta desde las 00:00 locales', () => {
  const corte = medianoche(AHORA)
  assert.equal(new Date(corte).getHours(), 0)
  const g = grafo([
    nodo({ id: 'hoy', tipo: 'worker', situacion: 'terminado', estado: textos.finalizado, desde: corte }),
    nodo({ id: 'ayer', tipo: 'worker', situacion: 'terminado', estado: textos.finalizado, desde: corte - 1 }),
    nodo({ id: 'vivo', tipo: 'worker', desde: corte + MIN }),
  ], [
    { tipo: 'mensaje', origen: 'a', destino: 'b', hora: corte + 1 },
    { tipo: 'mensaje', origen: 'a', destino: 'b', hora: corte - 1 },
    { tipo: 'lanzamiento', origen: 'a', destino: 'b', hora: corte + 1 },
  ], [corte, corte - 1, AHORA])
  assert.deepEqual(resumenDia(g, AHORA), { terminados: 1, mensajes: 1, cerrados: 2 })
})

test('Cuenta atrás de automatizaciones y orden por próxima ejecución', () => {
  assert.equal(cuentaAtras(AHORA + 13 * 60 * MIN, AHORA), 'en 13 h')
  assert.equal(cuentaAtras(AHORA + 25 * MIN, AHORA), 'en 25 min')
  assert.equal(cuentaAtras(AHORA + 3 * 24 * 60 * MIN, AHORA), 'en 3 d')
  assert.equal(cuentaAtras(AHORA - MIN, AHORA), textos.ahora)
  const captura = { automatizaciones: { filas: [
    { id: 'tarde', name: 'Backup', enabled: true, nextRunAt: AHORA + 60 * MIN },
    { id: 'pronto', name: 'Resumen', enabled: true, nextRunAt: AHORA + MIN },
    { id: 'apagada', name: 'Riego', enabled: false, nextRunAt: AHORA },
  ] } }
  assert.deepEqual(proximas(normalizar(captura, AHORA)).map(({ nombre }) => nombre), ['Resumen', 'Backup'])
})

test('Un item de la cola abre el mismo destino que la tarjeta de Bob', () => {
  const g = normalizar({ bots: { filas: [{ id: 'b1', name: 'Bob', homeWorktreeId: 'folder:bob' }] } }, AHORA)
  const bob = g.nodos.find((otro) => otro.id === destinoItem(g))
  assert.equal(bob?.tipo, 'bob')
  assert.deepEqual(bob?.destino, { workspaceId: 'folder:bob' })
})

test('Workers activos bajo su bot, subiendo por coordinadores; terminados fuera y bots en reposo', () => {
  const g = grafo([
    nodo({ id: 'bob', tipo: 'bob' }), nodo({ id: 'huerto', tipo: 'bot' }),
    nodo({ id: 'w1', tipo: 'worker' }), nodo({ id: 'w2', tipo: 'worker' }),
    nodo({ id: 'w3', tipo: 'worker', situacion: 'terminado' }), nodo({ id: 'suelto', tipo: 'worker' }),
  ], [
    { tipo: 'lanzamiento', origen: 'huerto', destino: 'w1' },
    { tipo: 'lanzamiento', origen: 'w1', destino: 'w2' },
    { tipo: 'lanzamiento', origen: 'huerto', destino: 'w3' },
  ])
  assert.deepEqual(activosPorBot(g).map(({ bot, workers }) => [bot?.id ?? null, workers.map(({ id }) => id)]),
    [['huerto', ['w1', 'w2']], ['bob', []], [null, ['suelto']]])
})
