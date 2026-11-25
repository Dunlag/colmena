import assert from 'node:assert/strict'
import { mockHost, mount, test } from 'orca/testing'
import { normalizar } from './normalizar'
import * as panel from './panel'
import { textos } from './textos'

test('Pide el grafo y actualiza el recuento cuando llega otra captura', async () => {
  const inicial = normalizar({}, 1)
  const host = mockHost({ requests: { 'grafo.obtener': inicial } })
  const vista = await mount(panel, { host })
  try {
    assert.ok(vista.find({ text: textos.recuento(2, 1) }))
    const captura = { bots: { filas: [{ id: 'bob-1', name: 'Bob' }] } }
    await vista.post('grafo.actualizado', normalizar(captura, 2))
    assert.ok(vista.find({ text: textos.recuento(3, 3) }))
    assert.deepEqual(vista.errors, [])
  } finally {
    await vista.unmount()
  }
})

test('El botón del panel pide abrir la pestaña y muestra un fallo devuelto por el worker', async () => {
  const host = mockHost({ requests: {
    'grafo.obtener': normalizar({}, 1),
    'colmena.abrir': { error: textos.faltaEspacioLocal },
  } })
  const vista = await mount(panel, { host })
  try {
    await vista.press({ text: textos.abrirColmena })
    assert.ok(vista.find({ text: textos.faltaEspacioLocal }))
    assert.deepEqual(vista.errors, [])
  } finally {
    await vista.unmount()
  }
})
