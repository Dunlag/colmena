import { readFileSync } from 'node:fs'
import type { Captura, Fila } from './datos'
import { normalizar } from './normalizar'

function leer(nombre: string, campo: string): Fila[] {
  const ruta = new URL(`../fixtures/${nombre}.json`, import.meta.url)
  return JSON.parse(readFileSync(ruta, 'utf8')).result[campo]
}

export function capturaEjemplo(): Captura {
  return {
    bots: { filas: leer('bots', 'bots') },
    trabajos: { Huerto: { filas: leer('trabajos', 'workspaces') } },
    pendientes: { filas: leer('pendientes', 'items') },
    worktrees: { filas: leer('worktrees', 'worktrees') },
    workers: { filas: leer('workers', 'workers') },
    mensajes: { filas: leer('mensajes', 'messages') },
    automatizaciones: { filas: leer('automatizaciones', 'automations') },
  }
}

export function grafoEjemplo() {
  const ruta = new URL('../fixtures/maquinas.json', import.meta.url)
  const maquinas = JSON.parse(readFileSync(ruta, 'utf8'))
  const captura = capturaEjemplo()
  captura.entornos = { filas: maquinas['environment list'].result.environments }
  captura.remotasVivas = Object.fromEntries(['deck', 'chopper'].map((id) => [id, {
    worktrees: { filas: maquinas[id]['worktree ps'].result.worktrees },
    terminales: { filas: maquinas[id]['terminal list'].result.terminals },
    workers: { filas: maquinas[id]['orchestration worker-list'].result.workers },
    bots: { filas: maquinas[id]['bot list'].result.bots },
  }]))
  return normalizar(captura, Date.parse('2026-11-25T12:03:00.000Z'))
}
