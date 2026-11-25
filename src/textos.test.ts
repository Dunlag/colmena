import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { traducirAsunto } from './textos'

test('Traduce los asuntos de sistema de Orca conocidos', () => {
  assert.equal(traducirAsunto('Worker stopped without reporting'), 'El worker paró sin informar')
  assert.equal(traducirAsunto('Worker is waiting for permission'), 'El worker espera un permiso')
  assert.equal(traducirAsunto('Worker approval answered'), 'Permiso del worker respondido')
  assert.equal(traducirAsunto('Question'), 'Pregunta')
  assert.equal(traducirAsunto('Re: Question'), 'Re: Pregunta')
})

test('Deja igual los asuntos desconocidos o que solo se parecen', () => {
  assert.equal(traducirAsunto('Revisa el informe de Bob'), 'Revisa el informe de Bob')
  assert.equal(traducirAsunto('question'), 'question')
  assert.equal(traducirAsunto('Re: Question extra'), 'Re: Question extra')
  assert.equal(traducirAsunto('constructor'), 'constructor')
})
