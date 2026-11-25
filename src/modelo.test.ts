import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { clave, LOCAL } from './datos'
import { depurarModelos, DIA_MS, leerModelo } from './modelo'
import { textos } from './textos'

test('Lee el modelo con argumentos entre comillas y reconoce el agente', () => {
  assert.deepEqual(leerModelo('  API_KEY="dato privado" exec "/ruta con espacios/codex" --model "modelo con espacios" '),
    { agente: 'codex', modelo: 'modelo con espacios' })
  assert.deepEqual(leerModelo("opencode --model='proveedor/modelo' --flag"), { agente: 'opencode', modelo: 'proveedor/modelo' })
  assert.deepEqual(leerModelo('cursor-agent -m cursor-ejemplo', 'cursor'), { agente: 'cursor', modelo: 'cursor-ejemplo' })
  assert.deepEqual(leerModelo('codex -m gpt-ejemplo'), { agente: 'codex', modelo: 'gpt-ejemplo' })
})

test('Omite flags ajenos, valores ausentes y comandos posteriores', () => {
  assert.deepEqual(leerModelo('claude -m mensaje --modelos otro -- --model falso'), { agente: 'claude', modelo: null })
  assert.deepEqual(leerModelo('codex --model --otra-cosa; echo --model secreto'), { agente: 'codex', modelo: null })
  assert.deepEqual(leerModelo('codex --config=foo --prompt "hola; --model falso" --model=bien'), { agente: 'codex', modelo: 'bien' })
  assert.deepEqual(leerModelo('codex --prompt "--model=secreto"'), { agente: 'codex', modelo: null })
  assert.deepEqual(leerModelo('codex --model '), { agente: 'codex', modelo: null })
  assert.equal(leerModelo(' '), null)
  assert.equal(leerModelo('codex --model "sin cierre'), null)
})

test('Depura a las 24 horas y borra terminales ausentes solo con un inventario completo', () => {
  const ahora = 1795608000000
  const deck = 'runtime:deck'
  const modelo = { agente: 'codex', modelo: 'ejemplo', maquina: LOCAL, desde: ahora - 5000 }
  const guardados = {
    [clave(LOCAL, 'term_vivo')]: modelo,
    [clave(LOCAL, 'term_borrado')]: modelo,
    [clave(LOCAL, 'term_nuevo')]: { ...modelo, desde: ahora },
    [clave(LOCAL, 'term_caducado')]: { ...modelo, desde: ahora - DIA_MS },
    [clave(deck, 'term_borrado')]: { ...modelo, maquina: deck },
  }
  const inventarios = [
    { base: LOCAL, fuente: { filas: [{ handle: 'term_vivo' }], hosts: [LOCAL] } },
    { base: deck, fuente: { filas: [], fallo: { maquina: deck, fuente: 'terminal list', codigo: 'timeout', mensaje: textos.tiempoAgotado } } },
  ]
  assert.deepEqual(Object.keys(depurarModelos(guardados, ahora, inventarios)),
    [clave(LOCAL, 'term_vivo'), clave(LOCAL, 'term_nuevo'), clave(deck, 'term_borrado')])
})
