import { fecha, filas, objeto, texto, type Captura, type FalloFuente, type Fila } from './datos'
import { textos } from './textos'

const DIA_MS = 24 * 60 * 60 * 1000
const LOCAL = 'local'
const TU = 'tu'

type Pendiente = { id: string; tarea: string; desde: number | null }

export type Nodo = {
  id: string
  tipo: 'tu' | 'bot' | 'worker' | 'automatizacion' | 'maquina'
  nombre: string
  estado: string
  maquina: string
  tarea: string | null
  desde: number | null
  agente?: string
  modelo?: string
  atenuado?: true
  pendientes?: Pendiente[]
}

export type Arista = {
  tipo: 'agrupa' | 'lanzamiento' | 'mensaje'
  origen: string
  destino: string
  hora?: number
  asunto?: string
}

export type Grafo = {
  nodos: Nodo[]
  aristas: Arista[]
  generado: number
  fallos: FalloFuente[]
}

const estados: Record<string, string> = {
  working: textos.enCurso, running: textos.enCurso, active: textos.enCurso,
  waiting: textos.espera, idle: textos.espera, blocked: textos.bloqueado,
  ready: textos.pendiente, queued: textos.pendiente, planned: textos.pendiente,
  dispatched: textos.pendiente,
  done: textos.finalizado, succeeded: textos.finalizado, completed: textos.finalizado,
  failed: textos.fallido, failure: textos.fallido, lost: textos.fallido,
  stopped: textos.cancelado, canceled: textos.cancelado, cancelled: textos.cancelado,
  abandoned: textos.cancelado,
}

const cerrados = new Set([
  'done', 'succeeded', 'completed', 'failed', 'failure', 'lost', 'stopped', 'canceled', 'cancelled', 'abandoned',
])

function estado(valor: string | null): string {
  return valor && Object.hasOwn(estados, valor) ? estados[valor] : textos.desconocido
}

function linea(...valores: unknown[]): string | null {
  return texto(...valores)?.replace(/\s+/g, ' ').slice(0, 240) ?? null
}

function sesion(valor: unknown): string | null {
  const id = texto(valor)
  return id && (id.startsWith('orca_session_id:') ? id : `orca_session_id:${id}`)
}

function claves(...valores: unknown[]): string[] {
  return valores.flatMap((valor) => texto(valor) ?? [])
}

function servidorId(servidor: Fila): string | null {
  const selector = texto(servidor.environmentId, servidor.on)
  return selector && `runtime:${encodeURIComponent(selector)}`
}

function espacioId(espacio: Fila): string {
  return texto(espacio.hostId, objeto(espacio.environment).id) ?? LOCAL
}

type Observacion = {
  ids: string[]
  maquina: string
  workspace?: string | null
  padre?: string | null
  bot?: string | null
  nombre: string | null
  agente: string | null
  modelo: string | null
  tarea: string | null
  estado: string | null
  desde: number | null
  fin?: number | null
  tareaId?: string | null
}

function desdeAgente(agente: Fila, espacio: Fila): Observacion {
  const principal = objeto(agente.mainAgent)
  const status = texto(principal.state, agente.state)
  const desde = fecha(principal.stateStartedAt, agente.stateStartedAt, agente.updatedAt)
  return {
    ids: claves(sesion(agente.orcaSessionId), agente.address, agente.terminalHandle, agente.paneKey, agente.id),
    maquina: espacioId(espacio),
    workspace: texto(espacio.worktreeId),
    padre: texto(agente.parentPaneKey, espacio.parentWorktreeId),
    bot: texto(espacio.bot),
    nombre: linea(agente.conversationName, agente.displayName, espacio.displayName),
    agente: texto(agente.agentType, agente.agent),
    modelo: texto(agente.model),
    tarea: linea(agente.taskTitle, agente.prompt, espacio.comment),
    estado: status,
    desde,
    fin: status && cerrados.has(status) ? desde : null,
  }
}

function desdeDispatch(worker: Fila): Observacion {
  const proyeccion = objeto(worker.projection)
  const recurso = objeto(worker.resource)
  const proveedor = objeto(proyeccion.provider)
  const etapa = objeto(proyeccion.stage)
  const evidencia = objeto(proyeccion.evidence)
  const padre = objeto(proyeccion.parent)
  const espacio = objeto(proyeccion.workspace)
  const servidor = objeto(worker.server)
  const host = objeto(proyeccion.host)
  const id = texto(worker.dispatchId, proyeccion.dispatchId, proyeccion.id)
  const tarea = texto(worker.taskId, proyeccion.taskId)
  const estadosDispatch = claves(worker.workerState, etapa.worker, worker.dispatchStatus, etapa.dispatch)
  const cerrado = estadosDispatch.find((status) => cerrados.has(status))
  const actividad = etapa.activity === 'done' ? 'idle' : etapa.activity
  const fin = fecha(worker.completedAt, worker.finishedAt, proyeccion.completedAt,
    recurso.releaseCompletedAt, servidor.asOf, evidencia.lastObservedAt)
  return {
    ids: claves(worker.agentTerminalHandle, recurso.terminalHandle, sesion(proveedor.sessionId),
      worker.paneKey, id && `dispatch:${id}`, id),
    maquina: servidorId(servidor) ?? texto(host.id, worker.hostId) ?? LOCAL,
    workspace: texto(espacio.id, recurso.worktreeId),
    padre: texto(padre.dispatchId, padre.id, padre.address, worker.coordinatedFrom,
      texto(padre.taskId) && `task:${padre.taskId}`),
    bot: texto(worker.bot),
    nombre: linea(worker.title, espacio.name),
    agente: texto(proveedor.id, worker.agent),
    modelo: texto(proveedor.model, worker.model),
    tarea: linea(worker.taskTitle, worker.title, worker.spec),
    estado: cerrado ?? texto(actividad === 'unknown' ? null : actividad, ...estadosDispatch),
    desde: cerrado ? fin : fecha(worker.startedAt, worker.createdAt, evidencia.lastObservedAt, servidor.asOf),
    fin: cerrado ? fin : null,
    tareaId: tarea,
  }
}

function desdeTrabajo(trabajo: Fila, bot: string, maquina: string): Observacion {
  const agente = objeto(trabajo.agent)
  const status = trabajo.idle === true ? 'idle' : texto(trabajo.state, trabajo.status, agente.state)
  const desde = fecha(trabajo.startedAt, trabajo.createdAt, agente.stateStartedAt)
  return {
    ids: claves(trabajo.terminalHandle, trabajo.agentTerminalHandle, sesion(trabajo.orcaSessionId),
      trabajo.dispatchId, trabajo.workerId, trabajo.id),
    maquina: texto(trabajo.hostId) ?? maquina,
    workspace: texto(trabajo.worktreeId, trabajo.workspaceId),
    bot,
    nombre: linea(trabajo.title, trabajo.name),
    agente: texto(agente.agentType, trabajo.agent, agente.id),
    modelo: texto(trabajo.model, agente.model),
    tarea: linea(trabajo.taskTitle, trabajo.title, trabajo.task, objeto(trabajo.source).title),
    estado: status,
    desde,
    fin: fecha(trabajo.completedAt, trabajo.finishedAt, trabajo.updatedAt),
  }
}

export function normalizar(captura: Captura, ahora: number): Grafo {
  const nodos = new Map<string, Nodo>()
  const aristas = new Map<string, Arista>()
  const bots = new Map<string, string>()
  const participantes = new Map<string, string>()
  const nombresMaquina = new Map<string, string>([[LOCAL, textos.local]])
  const maquinasPorNombre = new Map<string, string>()
  const maquinasObservadas = new Set<string>()
  const clave = (maquina: string, id: string) => JSON.stringify([maquina, id])

  function conectar(arista: Arista, id?: string) {
    if (arista.origen === arista.destino || !nodos.has(arista.origen) || !nodos.has(arista.destino)) return
    aristas.set(JSON.stringify([arista.tipo, arista.origen, arista.destino, id]), arista)
  }

  for (const espacio of captura.worktrees?.filas ?? []) {
    const nombre = texto(objeto(espacio.environment).name, objeto(espacio.address).environment)
    const host = espacioId(espacio)
    maquinasObservadas.add(host)
    if (nombre && host !== LOCAL && nombre !== LOCAL) {
      nombresMaquina.set(host, nombre)
      maquinasPorNombre.set(nombre, host)
    }
  }
  const dispatches = (captura.workers?.filas ?? []).map((worker) => {
    const visto = desdeDispatch(worker)
    const nombre = texto(objeto(worker.server).name)
    if (nombre && visto.maquina !== LOCAL) {
      nombresMaquina.set(visto.maquina, nombre)
      maquinasPorNombre.set(nombre, visto.maquina)
    }
    return visto
  })
  const maquinaDispatch = new Map<string, string>()
  for (const visto of dispatches) {
    for (const id of visto.ids) {
      if (id.startsWith('dispatch:')) maquinaDispatch.set(id, visto.maquina)
    }
  }

  const pendientes = (captura.pendientes?.filas ?? []).flatMap((item) => {
    const id = texto(item.uid) ?? (typeof item.number === 'number' ? String(item.number) : null)
    const tarea = linea(item.title, item.question)
    return id && tarea && item.status === 'needs_you'
      ? [{ id, tarea, desde: fecha(item.updatedAt, item.createdAt) }] : []
  })
  const cola = pendientes.length
    ? textos.cola(pendientes.length)
    : captura.pendientes && !captura.pendientes.fallo ? textos.sinPendientes : textos.colaDesconocida
  nodos.set(TU, {
    id: TU, tipo: 'tu', nombre: textos.tu,
    estado: cola, tarea: pendientes[0]?.tarea ?? null, desde: pendientes[0]?.desde ?? null,
    maquina: LOCAL, pendientes,
  })

  for (const bot of captura.bots?.filas ?? []) {
    const original = texto(bot.id)
    const nombre = texto(bot.name)
    if (!original || !nombre) continue
    const agente = texto(bot.agent)
    const modelo = texto(bot.model)
    const id = `bot:${original}`
    const servidor = objeto(bot.server)
    const nombreServidor = texto(servidor.name)
    const maquina = texto(bot.hostId) ?? (nombreServidor && maquinasPorNombre.get(nombreServidor)) ??
      servidorId(servidor) ?? LOCAL
    if (nombreServidor) nombresMaquina.set(maquina, nombreServidor)
    if (!nodos.has(id)) nodos.set(id, {
      id, tipo: 'bot', nombre, maquina, estado: bot.paused ? textos.pausado : textos.disponible,
      tarea: linea(bot.specialty), desde: fecha(bot.updatedAt, bot.createdAt),
      ...(agente && { agente }), ...(modelo && { modelo }),
    })
    for (const alias of [original, nombre]) {
      bots.set(clave(maquina, alias), id)
      if (alias === original || maquina === LOCAL) bots.set(alias, id)
      participantes.set(clave(maquina, `bot:${alias}`), id)
    }
  }

  const bob = bots.get(textos.bob)
  if (bob) {
    conectar({ tipo: 'agrupa', origen: TU, destino: bob })
    for (const id of new Set(bots.values())) conectar({ tipo: 'agrupa', origen: bob, destino: id })
  }

  const propietarios = new Map<string, string>()
  const trabajos: Observacion[] = []
  for (const [bot, fuente] of Object.entries(captura.trabajos ?? {})) {
    for (const fila of fuente.filas) {
      const id = texto(fila.id)
      if (id) propietarios.set(id, bot)
    }
    for (const fila of fuente.items ?? []) {
      const despacho = texto(fila.dispatchId)
      const servidor = texto(fila.server)
      const maquina = (despacho && maquinaDispatch.get(`dispatch:${despacho}`)) ??
        (servidor && maquinasPorNombre.get(servidor)) ?? nodos.get(bots.get(bot) ?? '')?.maquina ?? LOCAL
      trabajos.push(desdeTrabajo(fila, bot, maquina))
    }
  }

  const observaciones: Observacion[] = []
  for (const espacio of captura.worktrees?.filas ?? []) {
    const agentes = filas(espacio.agents)
    const host = espacioId(espacio)
    const id = texto(espacio.worktreeId)
    const propietario = (id && propietarios.get(id)) || texto(espacio.bot)
    const bot = propietario ? (bots.get(clave(host, propietario)) ?? bots.get(propietario)) : undefined

    for (const agente of agentes) {
      const visto = desdeAgente(agente, espacio)
      visto.bot = propietario
      if (espacio.botHome === true && bot && !agente.parentPaneKey) {
        for (const alias of visto.ids) {
          participantes.set(clave(visto.maquina, alias), bot)
        }
        const nodo = nodos.get(bot)!
        if (visto.desde !== null && (nodo.desde === null || visto.desde >= nodo.desde)) {
          nodo.desde = visto.desde
          nodo.tarea = visto.tarea ?? nodo.tarea
          nodo.maquina = visto.maquina
          if (nodo.estado !== textos.pausado) nodo.estado = estado(visto.estado === 'done' ? 'idle' : visto.estado)
          if (visto.modelo) nodo.modelo = visto.modelo
        }
      } else {
        observaciones.push(visto)
      }
    }
  }

  const activosPorEspacio = new Map<string, Set<string>>()
  for (const visto of dispatches) {
    if (!visto.workspace || !visto.estado || cerrados.has(visto.estado)) continue
    const llave = clave(visto.maquina, visto.workspace)
    const activos = activosPorEspacio.get(llave) ?? new Set<string>()
    for (const id of visto.ids.slice(0, 1)) activos.add(id)
    activosPorEspacio.set(llave, activos)
  }

  for (const visto of [...dispatches, ...trabajos]) {
    if (!visto.workspace || !visto.estado || cerrados.has(visto.estado)) continue
    // Algunas vistas omiten el handle del panel. Vincula por workspace solo si la pareja es inequívoca.
    const candidatos = observaciones.filter((otro) =>
      otro.maquina === visto.maquina && otro.workspace === visto.workspace && otro.ids.length > 0)
    const activos = activosPorEspacio.get(clave(visto.maquina, visto.workspace))
    if (candidatos.length === 1 && (activos?.size ?? 0) <= 1 &&
        (!visto.agente || !candidatos[0].agente || visto.agente === candidatos[0].agente)) {
      visto.ids.push(candidatos[0].ids[0])
    }
  }

  // Índice por máquina para poder unir observaciones con alias distintos sin mezclar hosts.
  const grupos = new Map<string, Observacion[]>()
  const aliasPorMaquina = new Map<string, string>()
  for (const visto of [...observaciones, ...dispatches, ...trabajos]) {
    const ids = visto.ids.map((id) => clave(visto.maquina, id))
    if (!ids.length) continue
    const existentes = new Set(ids.flatMap((id) => aliasPorMaquina.get(id) ?? []))
    const canonico = existentes.values().next().value ?? ids[0]
    const grupo = grupos.get(canonico) ?? []
    for (const anterior of existentes) {
      if (anterior !== canonico) {
        grupo.push(...(grupos.get(anterior) ?? []))
        grupos.delete(anterior)
      }
    }
    grupo.push(visto)
    grupos.set(canonico, grupo)
    for (const entrada of grupo) {
      for (const id of entrada.ids) aliasPorMaquina.set(clave(entrada.maquina, id), canonico)
    }
  }

  const origenes: { id: string; grupo: Observacion[] }[] = []
  const porEspacio = new Map<string, Set<string>>()
  const porTarea = new Map<string, string>()
  for (const [canonico, grupo] of grupos) {
    // La observación del estado más reciente prevalece ante terminales reutilizados.
    grupo.sort((a, b) => (b.desde ?? 0) - (a.desde ?? 0))
    const actual = grupo.find((visto) => visto.estado) ?? grupo[0]
    const cerrado = actual.estado && cerrados.has(actual.estado)
    const fin = actual.fin
    if (cerrado && (fin == null || ahora - fin >= DIA_MS)) continue

    const id = `worker:${canonico}`
    const agente = texto(...grupo.map((visto) => visto.agente))
    const modelo = texto(...grupo.map((visto) => visto.modelo))
    nodos.set(id, {
      id, tipo: 'worker', nombre: actual.nombre ?? agente ?? textos.worker,
      estado: estado(actual.estado), maquina: actual.maquina, desde: actual.desde,
      tarea: linea(...grupo.map((visto) => visto.tarea)),
      ...(agente && { agente }), ...(modelo && { modelo }),
      ...(cerrado && { atenuado: true as const }),
    })
    origenes.push({ id, grupo })
    for (const visto of grupo) {
      if (visto.tareaId) {
        const llave = clave(visto.maquina, `task:${visto.tareaId}`)
        const previo = porTarea.get(llave)
        if (!previo || (nodos.get(previo)?.desde ?? 0) < (actual.desde ?? 0)) porTarea.set(llave, id)
      }
      for (const alias of visto.ids) {
        participantes.set(clave(visto.maquina, alias), id)
        if (visto.maquina === LOCAL) participantes.set(alias, id)
      }
      if (visto.workspace) {
        const llave = clave(visto.maquina, visto.workspace)
        const miembros = porEspacio.get(llave) ?? new Set<string>()
        miembros.add(id)
        porEspacio.set(llave, miembros)
      }
    }
  }

  for (const { id, grupo } of origenes) {
    for (const visto of grupo) {
      const posibles = visto.padre ? porEspacio.get(clave(visto.maquina, visto.padre)) : undefined
      const origen = (visto.padre && (
        participantes.get(clave(visto.maquina, visto.padre)) ??
        porTarea.get(clave(visto.maquina, visto.padre)) ??
        (posibles?.size === 1 ? posibles.values().next().value : undefined)
      )) || (visto.bot && (bots.get(clave(visto.maquina, visto.bot)) ?? bots.get(visto.bot))) ||
        (visto.workspace && bots.get(propietarios.get(visto.workspace) ?? ''))
      if (origen && origen !== id) {
        conectar({ tipo: 'lanzamiento', origen, destino: id })
        break
      }
    }
  }

  for (const auto of captura.automatizaciones?.filas ?? []) {
    const claveAuto = texto(auto.id)
    if (!claveAuto) continue
    const id = `automatizacion:${claveAuto}`
    const agente = texto(auto.agentId)
    const bot = objeto(auto.bot)
    const lanzamiento = objeto(objeto(bot.agentSetup).launch)
    const modelo = texto(auto.model, objeto(auto.agentSetup).model, lanzamiento.model)
    nodos.set(id, {
      id, tipo: 'automatizacion', nombre: linea(auto.name) ?? claveAuto,
      estado: auto.enabled ? textos.activa : textos.desactivada,
      maquina: texto(auto.executionTargetId) ?? LOCAL,
      tarea: linea(auto.prompt, auto.name), desde: fecha(auto.lastRunAt, auto.createdAt),
      ...(agente && { agente }), ...(modelo && { modelo }),
    })
    const origen = bots.get(texto(bot.botId) ?? '')
    if (origen) conectar({ tipo: 'agrupa', origen, destino: id })
  }

  for (const mensaje of captura.mensajes?.filas ?? []) {
    const host = texto(mensaje.hostId) ?? LOCAL
    const origen = participantes.get(texto(mensaje.from_handle) ?? '') ??
      participantes.get(clave(host, texto(mensaje.from_handle) ?? ''))
    const destino = participantes.get(texto(mensaje.to_handle) ?? '') ??
      participantes.get(clave(host, texto(mensaje.to_handle) ?? ''))
    const hora = fecha(mensaje.created_at)
    if (!origen || !destino || hora === null) continue
    const asunto = linea(mensaje.subject)
    conectar({ tipo: 'mensaje', origen, destino, hora, ...(asunto && { asunto }) }, texto(mensaje.id) ?? String(hora))
    if (mensaje.type === 'dispatch' && nodos.get(destino)?.tipo === 'worker') {
      conectar({ tipo: 'lanzamiento', origen, destino, hora })
    }
  }

  for (const nodo of [...nodos.values()]) {
    const id = `maquina:${nodo.maquina}`
    if (!nodos.has(id)) nodos.set(id, {
      id, tipo: 'maquina', nombre: nombresMaquina.get(nodo.maquina) ?? nodo.maquina,
      estado: maquinasObservadas.has(nodo.maquina) ? textos.disponible : textos.desconocido,
      maquina: nodo.maquina, tarea: null, desde: null,
    })
    conectar({ tipo: 'agrupa', origen: id, destino: nodo.id })
  }

  const fuentes = [
    captura.bots, ...Object.values(captura.trabajos ?? {}), captura.pendientes, captura.worktrees,
    captura.workers, captura.mensajes, captura.automatizaciones,
  ]
  return {
    nodos: [...nodos.values()],
    aristas: [...aristas.values()],
    generado: ahora,
    fallos: fuentes.flatMap((fuente) => fuente?.fallo ?? []),
  }
}
