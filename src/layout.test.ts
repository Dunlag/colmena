import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { LOCAL } from './datos'
import { grafoEjemplo } from './ejemplo'
import { curva, disponer } from './layout'
import type { Arista, Nodo } from './normalizar'
import { textos } from './textos'

for (const cantidad of [1, 5, 30]) {
  test(`Dispone ${cantidad} nodos sin solapes y dentro de su máquina`, () => {
    const nodos: Nodo[] = Array.from({ length: cantidad }, (_, i) => ({
      id: String(i), tipo: i === 0 ? 'tu' : 'worker', nombre: String(i), estado: textos.enCurso, situacion: 'trabajando',
      desde: null, tarea: null, maquina: [LOCAL, 'deck', 'chopper'][i % 3],
    }))
    const aristas: Arista[] = nodos.slice(1).map((nodo, i) => ({
      tipo: 'lanzamiento', origen: nodos[i].id, destino: nodo.id,
    }))
    const { bandas, posiciones, padres, ancho, alto } = disponer({ nodos, aristas })
    assert.equal(bandas.length, Math.min(cantidad, 3))
    assert.equal(bandas[0].id, LOCAL)
    assert.equal(posiciones.size, cantidad)
    assert.equal(padres.size, cantidad - 1)
    const tarjetas = [...posiciones.values()]
    for (const [actual, siguiente] of bandas.slice(0, -1).map((banda, i) => [banda, bandas[i + 1]])) {
      assert.ok(siguiente.y > actual.y + actual.alto)
    }
    for (const [i, actual] of tarjetas.entries()) {
      const banda = bandas.find(({ id }) => id === actual.nodo.maquina)!
      assert.ok(actual.x >= 12 && actual.x + actual.ancho <= 12 + banda.ancho)
      assert.ok(actual.y >= banda.y && actual.y + actual.alto <= banda.y + banda.alto)
      assert.ok(banda.y >= 0 && banda.y + banda.alto <= alto && banda.ancho <= ancho)
      for (const otra of tarjetas.slice(i + 1)) {
        assert.ok(actual.x + actual.ancho <= otra.x || otra.x + otra.ancho <= actual.x ||
          actual.y + actual.alto <= otra.y || otra.y + otra.alto <= actual.y)
      }
      const padre = padres.get(actual.nodo.id)
      if (padre) assert.match(curva(posiciones.get(padre)!, actual), /^M .* C /s)
    }
  })
}

test('Coloca TÚ, Bob, bot y worker en orden y conserva las automatizaciones', () => {
  const { posiciones, padres, bandas } = disponer(grafoEjemplo())
  const ids = ['tu', 'bot:bob-1', 'bot:bot-2', 'worker:["local","orca_session_id:sesion-a"]']
  for (const [i, hijo] of ids.slice(1).entries()) {
    assert.equal(padres.get(hijo), ids[i])
    const padre = posiciones.get(ids[i])!
    const tarjeta = posiciones.get(hijo)!
    if (i === 0) {
      assert.equal(tarjeta.x, padre.x)
      assert.ok(tarjeta.y > padre.y)
    } else {
      assert.ok(tarjeta.x > padre.x)
    }
  }
  assert.equal(padres.get('automatizacion:riego'), 'bot:bot-2')
  assert.deepEqual(bandas.map(({ nombre }) => nombre), [textos.local, 'Chopper', 'Deck'])
})

test('Descarta un ciclo y conserva una sola conexión por hijo', () => {
  const { nodos } = grafoEjemplo()
  const { padres } = disponer({
    nodos,
    aristas: [
      { tipo: 'lanzamiento', origen: 'bot:bob-1', destino: 'bot:bot-2' },
      { tipo: 'lanzamiento', origen: 'bot:bot-2', destino: 'bot:bob-1' },
      { tipo: 'agrupa', origen: 'tu', destino: 'bot:bob-1' },
    ],
  })
  for (const nodo of nodos.filter(({ tipo, situacion }) => tipo === 'bob' || tipo === 'bot' || (tipo === 'worker' && situacion !== 'terminado'))) {
    assert.ok(padres.has(nodo.id))
  }
  for (const id of padres.keys()) {
    const vistos = new Set([id])
    for (let padre = padres.get(id); padre; padre = padres.get(padre)) {
      assert.ok(!vistos.has(padre))
      vistos.add(padre)
    }
  }
})

test('Los workers terminados de un bot se pliegan en una tarjeta y se despliegan con su id', () => {
  const base = (id: string, tipo: Nodo['tipo'], situacion: Nodo['situacion']): Nodo => ({
    id, tipo, nombre: id, estado: situacion, situacion, desde: null, tarea: null, maquina: LOCAL,
  })
  const nodos = [
    base('tu', 'tu', 'esperando'), base('bob', 'bob', 'esperando'), base('bot', 'bot', 'esperando'),
    base('w1', 'worker', 'trabajando'), base('w2', 'worker', 'terminado'), base('w3', 'worker', 'terminado'),
  ]
  const aristas: Arista[] = ['bob', 'bot'].map((destino, i) => ({
    tipo: 'agrupa', origen: i ? 'bob' : 'tu', destino,
  }))
  for (const destino of ['w1', 'w2', 'w3']) aristas.push({ tipo: 'lanzamiento', origen: 'bot', destino })
  const plegado = disponer({ nodos, aristas })
  assert.deepEqual([...plegado.posiciones.keys()].sort(), ['bob', 'bot', 'grupo:bot', 'tu', 'w1'])
  assert.equal(plegado.posiciones.get('grupo:bot')?.nodo.miembros, 2)
  assert.deepEqual(plegado.recuento, { nodos: 5, conexiones: 4 })
  assert.equal(plegado.padres.size, 4)
  const abierto = disponer({ nodos, aristas }, 850, new Set(['grupo:bot']))
  assert.equal(abierto.posiciones.size, 7)
  assert.deepEqual(abierto.recuento, { nodos: 7, conexiones: 6 })
  assert.ok(abierto.posiciones.get('w2')!.y > abierto.posiciones.get('grupo:bot')!.y)
})
