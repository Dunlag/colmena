import type { OrcaWorkerApi } from 'orca/worker'
import { clave, LOCAL, type Captura, type Fila } from './datos'
import { lector, vivas } from './fuentes'
import { CLAVE_MODELOS, depurarModelos, leerModelo, type Modelos } from './modelo'
import { abrirColmena, abrirNodo } from './navegar'
import { normalizar } from './normalizar'
import { VIGENCIA_VISTA_MS } from './protocol'
import { textos } from './textos'

export const eventos = [
  'agent.status.changed', 'workspace.created', 'workspace.removed', 'workspace.changed',
] as const

const DEBOUNCE_MS = 750
/** Ronda de CLI con la pestaña a la vista. */
export const OTRAS_MS = 120_000
/** Ronda de CLI con solo el panel lateral a la vista: lo vivo llega por la API y los eventos. */
export const SOLO_PANEL_MS = 600_000
const OBSOLETO_MS = 300_000
export const hookModelo = 'agent.launch.before'

export function activar(orca: OrcaWorkerApi, crearLector = lector, leerVivas = vivas): () => Promise<void> {
  const vida = new AbortController()
  const fuentes = crearLector(vida.signal)
  const vistas = new Map<string, number>()
  const editores = new Set<string>()
  const actividad: Record<string, Fila> = Object.create(null)
  let captura: Captura = { actividad }
  let modelos: Modelos = {}
  let almacenamiento = Promise.resolve()
  let grafo = normalizar(captura, Date.now())
  let inicioOtra = -Infinity
  let temporizador: ReturnType<typeof setTimeout> | undefined
  let temporizadorVivas: ReturnType<typeof setTimeout> | undefined
  let consulta: AbortController | undefined
  let ultimaOtra = 0
  let leyendoVivas = false
  let vivasPendientes = true

  function publicar(parcial: Captura) {
    if (vida.signal.aborted) return
    captura = { ...captura, ...parcial }
    grafo = normalizar(captura, Date.now(), modelos)
    orca.panels.post('grafo.actualizado', grafo)
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

  function visibles(ahora: number) {
    for (const [id, vence] of vistas) {
      if (vence <= ahora) olvidar(id)
    }
    return vistas.size > 0
  }

  function olvidar(id: string) {
    vistas.delete(id)
    editores.delete(id)
  }

  function siguienteOtra() {
    return inicioOtra + (editores.size ? OTRAS_MS : SOLO_PANEL_MS)
  }

  /** Al abrir una vista, ronda en el acto si la última tiene más de 5 min. */
  function alAbrir() {
    if (Date.now() - ultimaOtra > OBSOLETO_MS) inicioOtra = -Infinity
  }

  function programar() {
    clearTimeout(temporizador)
    const ahora = Date.now()
    if (vida.signal.aborted || !visibles(ahora)) {
      consulta?.abort()
      return
    }
    const vence = Math.min(...vistas.values())
    if (!consulta && ahora >= siguienteOtra()) {
      void refrescar()
    } else {
      const siguiente = consulta ? vence : Math.min(vence, siguienteOtra())
      temporizador = setTimeout(programar, Math.max(0, siguiente - ahora))
    }
  }

  async function refrescar() {
    const actual = new AbortController()
    consulta = actual
    inicioOtra = Date.now()
    programar()
    try {
      const parcial = await fuentes.otras(actual.signal)
      if (!actual.signal.aborted) {
        ultimaOtra = Date.now()
        publicar(parcial)
      }
    } catch {
      if (!actual.signal.aborted) orca.log(textos.falloConsulta)
    } finally {
      // Una consulta cancelada no reemplaza el inventario anterior.
      if (actual.signal.aborted) inicioOtra = -Infinity
      consulta = undefined
      programar()
    }
  }

  async function refrescarVivas() {
    if (leyendoVivas || vida.signal.aborted) return
    leyendoVivas = true
    vivasPendientes = false
    try {
      const parcial = await leerVivas(orca.host, vida.signal)
      await actualizarModelos((guardado) => depurarModelos(guardado, Date.now()))
      publicar(parcial)
    } catch {
      if (!vida.signal.aborted) orca.log(textos.falloConsulta)
    } finally {
      leyendoVivas = false
      if (vivasPendientes) adelantar()
    }
  }

  function adelantar() {
    vivasPendientes = true
    if (temporizadorVivas || leyendoVivas || vida.signal.aborted) return
    temporizadorVivas = setTimeout(() => {
      temporizadorVivas = undefined
      void refrescarVivas()
    }, DEBOUNCE_MS)
  }

  orca.panels.handle('grafo.obtener', (_entrada, { panel }) => {
    if (vivasPendientes) adelantar()
    // Una vista que aún no avisa con vista.visible recibe los datos de la CLI al abrirse, y luego cada 5 min como mucho.
    if (Date.now() - ultimaOtra > OBSOLETO_MS && !consulta) {
      const id = `obtener:${panel.id}`
      vistas.set(id, Date.now() + VIGENCIA_VISTA_MS)
      if (panel.surface === 'editor') editores.add(id)
      alAbrir()
      programar()
    }
    return grafo
  })

  const suscripciones = [
    orca.events.on('agent.status.changed', (evento) => {
      if (evento.sessionId) {
        const id = evento.sessionId.startsWith('orca_session_id:') ? evento.sessionId : `orca_session_id:${evento.sessionId}`
        actividad[id] = {
          state: evento.mainAgent?.state ?? evento.state,
          stateStartedAt: evento.mainAgent?.stateStartedAt ?? evento.receivedAt,
        }
      }
      adelantar()
    }),
    ...eventos.filter((evento) => evento !== 'agent.status.changed').map((evento) => orca.events.on(evento, adelantar)),
  ]
  suscripciones.push(orca.panels.handle('vista.visible', ({ visible }, { panel }) => {
    if (visible === true) {
      visibles(Date.now())
      if (!vistas.has(panel.id)) alAbrir()
      vistas.set(panel.id, Date.now() + VIGENCIA_VISTA_MS)
      if (panel.surface === 'editor') editores.add(panel.id)
      if (!captura.worktrees) adelantar()
    } else {
      olvidar(panel.id)
    }
    programar()
    return {}
  }))
  suscripciones.push(
    orca.commands.register('colmena.abrir', async () => (await abrirColmena(orca.host)).error),
    orca.panels.handle('colmena.abrir', () => abrirColmena(orca.host)),
    orca.panels.handle('nodo.abrir', ({ id }, { signal }) =>
      abrirNodo(orca.host, signal, grafo.nodos.find((nodo) => nodo.id === id))),
  )
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
    clearTimeout(temporizadorVivas)
    consulta?.abort()
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
