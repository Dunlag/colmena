import type { OrcaWorkerApi } from 'orca/worker'
import type { Captura } from './datos'
import { lector } from './fuentes'
import { normalizar } from './normalizar'
import { textos } from './textos'

export const eventos = [
  'agent.status.changed', 'workspace.created', 'workspace.removed', 'workspace.changed',
] as const

const VIVAS_MS = 4_000
const OTRAS_MS = 20_000

export function activar(orca: OrcaWorkerApi, crearLector = lector): () => void {
  const vida = new AbortController()
  const fuentes = crearLector(vida.signal)
  let captura: Captura = {}
  let grafo = normalizar(captura, Date.now())
  let siguienteViva = 0
  let siguienteOtra = 0
  let temporizador: ReturnType<typeof setTimeout> | undefined
  let ocupado = false

  function publicar(parcial: Captura) {
    if (vida.signal.aborted) return
    captura = { ...captura, ...parcial }
    grafo = normalizar(captura, Date.now())
    orca.panels.post('grafo.actualizado', grafo)
  }

  async function consultarVivas() {
    if (vida.signal.aborted || Date.now() < siguienteViva) return
    siguienteViva = Date.now() + VIVAS_MS
    publicar(await fuentes.vivas())
  }

  function programar() {
    clearTimeout(temporizador)
    if (vida.signal.aborted || ocupado) return
    const demora = Math.max(0, Math.min(siguienteViva, siguienteOtra) - Date.now())
    temporizador = setTimeout(() => void refrescar(), demora)
  }

  async function refrescar() {
    ocupado = true
    try {
      await consultarVivas()
      if (!vida.signal.aborted && Date.now() >= siguienteOtra) {
        siguienteOtra = Date.now() + OTRAS_MS
        // Deja paso a una vuelta rápida entre consultas lentas, manteniendo un solo proceso CLI.
        publicar(await fuentes.otras(consultarVivas))
      }
    } catch {
      orca.log(textos.falloConsulta)
    } finally {
      ocupado = false
      programar()
    }
  }

  function adelantar() {
    siguienteViva = 0
    programar()
  }

  orca.panels.handle('grafo.obtener', () => {
    if (!ocupado && !temporizador) programar()
    return grafo
  })

  const suscripciones = eventos.map((evento) => orca.events.on(evento, adelantar))
  return () => {
    vida.abort()
    clearTimeout(temporizador)
    for (const suscripcion of suscripciones) suscripcion.dispose()
  }
}

let detener: (() => void) | undefined

export default function activate(orca: OrcaWorkerApi): void {
  detener = activar(orca)
}

export function deactivate(): void {
  detener?.()
  detener = undefined
}
