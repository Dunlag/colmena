import type { OrcaWorkerApi } from 'orca/worker'
import { clave, LOCAL, maquinaRemota, type Captura } from './datos'
import { lector } from './fuentes'
import { CLAVE_MODELOS, depurarModelos, leerModelo, type Modelos } from './modelo'
import { normalizar } from './normalizar'
import { textos } from './textos'

export const eventos = [
  'agent.status.changed', 'workspace.created', 'workspace.removed', 'workspace.changed',
] as const

const VIVAS_MS = 4_000
const OTRAS_MS = 20_000
const REGISTRO_TERMINAL_MS = 10_000
export const hookModelo = 'agent.launch.before'

export function activar(orca: OrcaWorkerApi, crearLector = lector): () => Promise<void> {
  const vida = new AbortController()
  const fuentes = crearLector(vida.signal)
  let captura: Captura = {}
  let modelos: Modelos = {}
  let almacenamiento = Promise.resolve()
  let grafo = normalizar(captura, Date.now())
  let siguienteViva = 0
  let siguienteOtra = 0
  let temporizador: ReturnType<typeof setTimeout> | undefined
  let ocupado = false

  function publicar(parcial: Captura) {
    if (vida.signal.aborted) return
    captura = { ...captura, ...parcial }
    grafo = normalizar(captura, Date.now(), modelos)
    orca.panels.post('grafo.actualizado', grafo)
  }

  async function consultarVivas() {
    const consultado = Date.now()
    if (vida.signal.aborted || consultado < siguienteViva) return
    siguienteViva = consultado + VIVAS_MS
    try {
      const parcial = await fuentes.vivas()
      if (vida.signal.aborted) return
      const inventarios = Object.entries(parcial.remotasVivas ?? {}).flatMap(([id, host]) =>
        host.terminales ? [{ base: maquinaRemota(id), fuente: host.terminales }] : [])
      if (parcial.terminales) inventarios.push({ base: LOCAL, fuente: parcial.terminales })
      await actualizarModelos((guardado) => depurarModelos(
        guardado, Date.now(), inventarios, consultado - REGISTRO_TERMINAL_MS,
      ))
      publicar(parcial)
    } finally {
      if (siguienteViva !== 0) siguienteViva = Date.now() + VIVAS_MS
    }
  }

  function actualizarModelos(cambiar: (guardado: unknown) => Modelos) {
    almacenamiento = almacenamiento.then(async () => {
      const guardado = await orca.storage.get(CLAVE_MODELOS)
      const actualizados = cambiar(guardado)
      if (JSON.stringify(guardado ?? {}) !== JSON.stringify(actualizados)) {
        await orca.storage.set(CLAVE_MODELOS, actualizados)
      }
      modelos = actualizados
    }).catch(() => orca.log(textos.falloModelos))
    return almacenamiento
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
        // Deja paso a una vuelta rápida entre consultas lentas, manteniendo un solo proceso CLI.
        try {
          publicar(await fuentes.otras(consultarVivas))
        } finally {
          siguienteOtra = Date.now() + OTRAS_MS
        }
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
  suscripciones.push(orca.hooks.on(hookModelo, ({ terminalId, agent, command }) => {
    if (vida.signal.aborted || !terminalId) return
    const desde = Date.now()
    const registro = leerModelo(command, agent)
    if (!registro) return
    void actualizarModelos((guardado) => ({
      ...depurarModelos(guardado, Date.now()),
      [clave(LOCAL, terminalId)]: { ...registro, maquina: LOCAL, desde },
    })).then(() => {
      publicar({})
      adelantar()
    })
  }))
  return async () => {
    vida.abort()
    clearTimeout(temporizador)
    for (const suscripcion of suscripciones) suscripcion.dispose()
    await almacenamiento
  }
}

let detener: (() => Promise<void>) | undefined

export default function activate(orca: OrcaWorkerApi): void {
  detener = activar(orca)
}

export async function deactivate(): Promise<void> {
  const finalizar = detener
  detener = undefined
  await finalizar?.()
}
