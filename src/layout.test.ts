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
      id: String(i), tipo: i === 0 ? 'tu' : 'worker', nombre: String(i), estado: textos.enCurso,
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
    for (const [i, actual] of tarjetas.entries()) {
      const banda = bandas.find(({ id }) => id === actual.nodo.maquina)!
      assert.ok(actual.x >= banda.x && actual.x + actual.ancho <= banda.x + banda.ancho)
      assert.ok(actual.y >= 0 && actual.y + actual.alto <= alto)
      assert.ok(banda.x >= 0 && banda.x + banda.ancho <= ancho)
      for (const otra of tarjetas.slice(i + 1)) {
        assert.ok(actual.x + actual.ancho <= otra.x || otra.x + otra.ancho <= actual.x ||
          actual.y + actual.alto <= otra.y || otra.y + otra.alto <= actual.y)
      }
      const padre = padres.get(actual.nodo.id)
      if (padre) assert.match(curva(posiciones.get(padre)!, actual), /^M .* Q /s)
    }
  })
}

test('Coloca TÚ, Bob, bot y worker en orden y conserva las automatizaciones', () => {
  const { posiciones, padres, bandas } = disponer(grafoEjemplo())
  const ids = ['tu', 'bot:bob-1', 'bot:bot-2', 'worker:["local","orca_session_id:sesion-a"]']
  for (const [i, hijo] of ids.slice(1).entries()) {
    assert.equal(padres.get(hijo), ids[i])
    assert.ok(posiciones.get(hijo)!.y > posiciones.get(ids[i])!.y)
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
  assert.equal(padres.size, nodos.filter(({ tipo }) => tipo !== 'maquina').length - 1)
  for (const id of padres.keys()) {
    const vistos = new Set([id])
    for (let padre = padres.get(id); padre; padre = padres.get(padre)) {
      assert.ok(!vistos.has(padre))
      vistos.add(padre)
    }
  }
})
