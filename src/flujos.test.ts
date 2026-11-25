import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { mensajes, tipoMensaje, ultimos30Segundos, type Mensaje } from './flujos'
import type { Arista } from './normalizar'

test('Ordena los mensajes y excluye los de 30 segundos exactos, sin hora o futuros', () => {
  const ruta = { origen: 'bob', destino: 'worker' }
  const ahora = 40_000
  const aristas: Arista[] = [
    { ...ruta, tipo: 'mensaje', hora: 10_001, asunto: 'Primero' },
    { ...ruta, tipo: 'mensaje', hora: 10_000 },
    { ...ruta, tipo: 'mensaje', hora: 40_001 },
    { ...ruta, tipo: 'lanzamiento', hora: ahora },
    { ...ruta, tipo: 'mensaje', hora: ahora, asunto: 'Segundo' },
    { ...ruta, tipo: 'mensaje', hora: ahora, asunto: 'Tercero' },
    { ...ruta, tipo: 'mensaje' },
  ]
  const historial = mensajes(aristas)
  assert.deepEqual(historial.map(({ hora }) => hora), [40_001, 40_000, 40_000, 10_001, 10_000])
  assert.deepEqual(ultimos30Segundos(historial, ahora).map(({ asunto }) => asunto), [
    'Segundo', 'Tercero', 'Primero',
  ])
  assert.deepEqual(ultimos30Segundos(historial, ahora + 30_001), [])
})

test('Conserva el tipo del mensaje y muestra Estado para capturas previas', () => {
  const historico: Mensaje = { tipo: 'mensaje', origen: 'bob', destino: 'bot', hora: 1 }
  assert.equal(tipoMensaje(historico), 'estado')
  for (const tipo of ['encargo', 'pregunta', 'estado', 'resultado'] as const) {
    assert.equal(tipoMensaje({ ...historico, mensaje: tipo }), tipo)
  }
})
