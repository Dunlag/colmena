import assert from 'node:assert/strict'
import { mockHost, mount, test } from 'orca/testing'
import { normalizar } from './normalizar'
import * as panel from './panel'
import { textos } from './textos'

test('Pide el grafo y redibuja la torre cuando llega otra captura', async () => {
  const host = mockHost({ requests: { 'grafo.obtener': normalizar({}, 1), 'vista.visible': {} } })
  const vista = await mount(panel, { host })
  try {
    assert.ok(vista.find({ text: textos.resumenDia(0, 0, 0) }))
    const captura = { bots: { filas: [{ id: 'huerto-1', name: 'Huerto' }] } }
    await vista.post('grafo.actualizado', normalizar(captura, 2))
    assert.match(vista.find({ type: 'ListItem', text: /Huerto/ })?.text ?? '', new RegExp(textos.enReposo))
    assert.deepEqual(vista.errors, [])
  } finally {
    await vista.unmount()
  }
})

test('El botón ⤢ pide abrir la pestaña y muestra un fallo devuelto por el worker', async () => {
  const host = mockHost({ requests: {
    'grafo.obtener': normalizar({}, 1), 'vista.visible': {},
    'colmena.abrir': { error: textos.faltaEspacioLocal },
  } })
  const vista = await mount(panel, { host })
  try {
    await vista.press({ label: textos.abrirPestana })
    assert.ok(vista.find({ text: textos.faltaEspacioLocal }))
    assert.deepEqual(vista.errors, [])
  } finally {
    await vista.unmount()
  }
})

test('Un item de la cola abre el chat de Bob y el umbral de atasco se guarda en storage', async () => {
  const pedidos: string[] = []
  const ahora = Date.now()
  const captura = {
    bots: { filas: [{ id: 'b1', name: 'Bob', homeWorktreeId: 'folder:bob' }] },
    pendientes: { filas: [{ uid: 'i1', title: 'Revisar el plan', status: 'needs_you', updatedAt: ahora }] },
  }
  const host = mockHost({ requests: {
    'grafo.obtener': normalizar(captura, ahora), 'vista.visible': {},
    'nodo.abrir': ({ id }: { id: string }) => { pedidos.push(id); return {} },
  } })
  const vista = await mount(panel, { host })
  try {
    await vista.press({ type: 'ListItem', text: /Revisar el plan/ })
    assert.deepEqual(pedidos, ['bot:b1'])
    await vista.select({ label: textos.minutosAtasco }, '30')
    assert.equal(vista.persisted.storage.minutosAtasco, 30)
    assert.deepEqual(vista.errors, [])
  } finally {
    await vista.unmount()
  }
})
