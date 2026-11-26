import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { DIA_MS } from './modelo'
import {
  entornosGuardados, fecha, filas, LOCAL, maquinaRemota, objeto, texto,
  type Captura, type CapturaHost, type Entorno, type FalloFuente, type Fuente, type Fila,
} from './datos'
import { textos } from './textos'

const LIMITE_MS = 2500
// Bots, trabajos de bots, automatizaciones y entornos cambian poco: se releen cada 10 min, no en cada ronda.
export const LENTA_MS = 600_000
// El roster local espera hasta 4 s por los pares antes de devolver sus propios bots.
const LIMITE_ROSTER_LOCAL_MS = 6000

function ejecutable(): string {
  if (process.env.ORCA_CLI_COMMAND) return process.env.ORCA_CLI_COMMAND
  if (process.env.ORCA_DEV_REPO_ROOT) return 'orca-dev'
  if (process.platform !== 'linux') return process.platform === 'win32' ? 'orca.exe' : 'orca'
  const local = join(homedir(), '.local', 'bin', 'orca-ide')
  return existsSync(local) ? local : 'orca-ide'
}

function ejecutar(argumentos: string[], signal: AbortSignal): Promise<string> {
  const env = { ...process.env }
  // El panel muestra todas las ejecuciones del host, incluso si Orca se abrió desde otro terminal.
  delete env.ORCA_TERMINAL_HANDLE
  delete env.ORCA_ENVIRONMENT
  delete env.ORCA_PAIRING_CODE
  const rosterLocal = argumentos[0] === 'bot' && argumentos[1] === 'list' &&
    argumentos[argumentos.indexOf('--environment') + 1] === LOCAL
  return new Promise((resolve, reject) => {
    execFile(ejecutable(), argumentos, {
      env, signal, timeout: rosterLocal ? LIMITE_ROSTER_LOCAL_MS : LIMITE_MS,
      killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8', windowsHide: true,
    }, (error, stdout) => {
      if (error && (error.killed || !stdout.trim())) reject(error)
      else resolve(stdout)
    })
  })
}

export type Ejecutar = typeof ejecutar

export async function enfocarTerminalRemoto(terminalId: string, entorno: string, signal: AbortSignal) {
  const respuesta = objeto(JSON.parse(await ejecutar([
    'terminal', 'switch', '--terminal', terminalId, '--environment', entorno, '--json',
  ], signal)))
  return respuesta.ok === true && objeto(objeto(respuesta.result).focus).navigated === true
}

type Host = OrcaWorkerApi['host']

export async function vivas(host: Host, signal: AbortSignal): Promise<Captura> {
  const { workspaces, truncated } = await host.call('workspace.list', { includeStatus: true }, { signal })
  const worktrees: Fila[] = []
  for (const espacio of workspaces) {
    if (signal.aborted) break
    // Las carpetas incluyen las sesiones de inicio de los bots, incluso cuando duermen.
    const consultar = espacio.kind === 'folder' || !espacio.status || espacio.status.terminalCount > 0
    const agentes = consultar
      ? await host.call('agents.list', { workspaceId: espacio.id }, { signal }).catch(() => ({ agents: [] }))
      : { agents: [] }
    worktrees.push({
      worktreeId: espacio.id, path: espacio.path, displayName: espacio.name,
      hostId: espacio.hostId, kind: espacio.kind,
      agents: agentes.agents.map(({ terminalId, title, agent, state, stateStartedAt, sessionId, task }) => ({
        terminalId, title, agent, state, stateStartedAt, orcaSessionId: sessionId, taskTitle: task?.title,
      })),
    })
  }
  return { worktrees: { filas: worktrees, ...(truncated && {
    fallo: { maquina: LOCAL, fuente: 'workspace.list', codigo: 'parcial', mensaje: textos.parcial },
  }) } }
}

type Lenta = { en: number; bots: Fuente; trabajos: Record<string, Fuente>; automatizaciones: Fuente; cerrados: Fuente }

export function lector(vida: AbortSignal, comando: Ejecutar = ejecutar, ahora: () => number = Date.now) {
  let signal = vida
  let entornosEn = 0
  const lentas = new Map<string, Lenta>()
  let entornos: Fuente | undefined
  let servidores: Entorno[] = []
  const detalles = new Map<string, Fila>()
  const propietarios = new Map<string, string>()

  async function consultar(
    argumentos: string[], campo: string, servidor?: Entorno, paginar = false, objetoUnico = false,
    suficiente?: (pagina: Fila[]) => boolean,
  ): Promise<Fuente> {
    const fuente = argumentos.join(' ')
    const maquina = servidor ? maquinaRemota(servidor.id) : LOCAL
    const selector = campo === 'environments' ? [] : ['--environment', servidor?.id ?? LOCAL]
    const acumuladas: Fila[] = []
    const cursores = new Set<string>()
    let cursor: string | null = null
    let items: Fila[] | undefined
    let hosts: string[] | undefined
    let fallo: FalloFuente | undefined

    do {
      if (signal.aborted) break
      try {
        const pagina: Fila = objeto(JSON.parse(await comando([
          ...argumentos, ...selector, ...(cursor ? ['--cursor', cursor] : []), '--json',
        ], signal)))
        const error = objeto(pagina.error)
        if (pagina.ok === false) {
          return { filas: acumuladas, fallo: {
            maquina, fuente, codigo: texto(error.code) ?? 'cli', mensaje: textos.falloConsulta,
          } }
        }
        const resultado = objeto(pagina.result)
        const valor = resultado[campo]
        if (pagina.ok !== true || (!objetoUnico && !Array.isArray(valor))) throw new SyntaxError()
        const recibidas = objetoUnico ? [objeto(valor)] : filas(valor)
        acumuladas.push(...recibidas)
        if (campo === 'workspaces') items = filas(resultado.items)
        const alcance = objeto(resultado.hostScope)
        if (Array.isArray(alcance.hostIds)) hosts = alcance.hostIds.flatMap((host) => texto(host) ?? [])
        const omitidos = alcance.omittedHostIds
        const fueraDeAlcance = Array.isArray(omitidos) && omitidos.some((id) =>
          !servidores.some((otro) => maquinaRemota(otro.id) === id))
        // El roster también trae bots de otros servidores. Sus consultas directas registran sus propios fallos.
        if (resultado.truncated === true || fueraDeAlcance ||
            (campo !== 'bots' && filas(resultado.unreachable).length > 0) || filas(resultado.partialHostErrors).length > 0) {
          fallo = { maquina, fuente, codigo: 'parcial', mensaje: textos.parcial }
        }
        cursor = paginar && !suficiente?.(recibidas) ? texto(objeto(resultado.page).nextCursor, resultado.nextCursor) : null
        if (cursor && cursores.has(cursor)) throw new SyntaxError()
        if (cursor) cursores.add(cursor)
      } catch (error) {
        const invalida = error instanceof SyntaxError
        const vencido = objeto(error).killed === true
        return { filas: acumuladas, fallo: {
          maquina, fuente,
          codigo: invalida ? 'json' : vencido ? 'timeout' : texto(objeto(error).code) ?? 'cli',
          mensaje: invalida ? textos.respuestaInvalida : vencido ? textos.tiempoAgotado : textos.falloConsulta,
        } }
      }
    } while (cursor)

    return { filas: acumuladas, items, hosts, fallo }
  }

  async function completarWorkers(workers: Fuente, servidor?: Entorno) {
    const porRun = new Map<string, Map<string, Fila>>()
    const maquina = servidor?.id ?? LOCAL
    const hoy = ahora()
    for (const worker of workers.filas) {
      if (signal.aborted) break
      const run = texto(worker.runId, objeto(worker.projection).runId)
      const tarea = texto(worker.taskId)
      const dispatch = texto(worker.dispatchId)
      if (!run || !tarea || !dispatch) continue
      const previo = detalles.get(`${maquina}:${dispatch}`)
      if (previo) {
        Object.assign(worker, previo)
        continue
      }
      const fin = fecha(objeto(worker.resource).releaseCompletedAt)
      if (fin !== null && hoy - fin >= DIA_MS) continue
      if (!porRun.has(run)) {
        const tareas = await consultar(['orchestration', 'task-list', '--run', run, '--full'], 'tasks', servidor)
        porRun.set(run, new Map(tareas.filas.map((fila) => [String(fila.id), fila])))
      }
      const registro = porRun.get(run)?.get(tarea)
      const finTarea = fecha(registro?.completed_at, fin)
      if (finTarea !== null && hoy - finTarea >= DIA_MS) continue
      const { filas: [contexto] } = await consultar(
        ['orchestration', 'dispatch-show', '--task', tarea, '--full'], 'dispatch', servidor, false, true,
      )
      const exacto = contexto?.id === dispatch ? contexto : undefined
      const coordinador = texto(exacto?.creator_orca_session_id, exacto?.creator_handle)
      if (coordinador && !exacto?.creator_dispatch_id) {
        propietarios.set(`${maquina}:${run}`, coordinador.includes(':') ? coordinador : `orca_session_id:${coordinador}`)
      }
      const prov = objeto(objeto(worker.projection).provider)
      const detalle = finTarea !== null && (!prov.id || !prov.model)
        ? (await consultar(['orchestration', 'worker-show', '--dispatch', dispatch, '--full'],
          'worker', servidor, false, true)).filas[0]
        : undefined
      const inicio = objeto(detalle?.startOptions)
      const lanzamiento = objeto(objeto(inicio.launch).effective)
      const metadatos = {
        taskTitle: texto(registro?.task_title, registro?.title, worker.taskTitle),
        completedAt: finTarea,
        createdAt: fecha(registro?.created_at),
        creatorSession: texto(exacto?.creator_orca_session_id),
        creatorHandle: texto(exacto?.creator_handle),
        creatorDispatch: texto(exacto?.creator_dispatch_id),
        assigneeSession: texto(exacto?.assignee_orca_session_id),
        agent: texto(prov.id, inicio.agent),
        model: texto(prov.model, lanzamiento.model, objeto(objeto(inicio.launch).requested).model),
      }
      // Una tarea terminada ya no cambia: se cachea aunque falte el coordinador para no repetir task-list y dispatch-show.
      if (finTarea !== null && metadatos.taskTitle) {
        detalles.set(`${maquina}:${dispatch}`, metadatos)
      }
      Object.assign(worker, metadatos)
    }
    for (const [id, campos] of detalles) {
      if (hoy - (fecha(campos.completedAt) ?? hoy) >= DIA_MS) detalles.delete(id)
    }
  }

  async function lentaHost(servidor?: Entorno): Promise<Lenta> {
    const id = servidor?.id ?? LOCAL
    const previa = lentas.get(id)
    if (previa && ahora() - previa.en < LENTA_MS) return previa
    const bots = await consultar(['bot', 'list'], 'bots', servidor)
    bots.filas = bots.filas.filter((bot) => !bot.server)
    const trabajos: Record<string, Fuente> = Object.create(null)
    for (const bot of bots.filas) {
      const nombre = texto(bot.name)
      const id = texto(bot.id) ?? nombre
      if (nombre && id && !Object.hasOwn(trabajos, id)) {
        trabajos[id] = await consultar(['bot', 'work', 'list', '--bot', nombre], 'workspaces', servidor)
      }
    }
    const automatizaciones = await consultar(['automations', 'list'], 'automations', servidor)
    // shortcut: una página (50, lo más reciente primero) basta para contar los cerrados de hoy; con más de 50 al día, paginar.
    const cerrados = await consultar(
      ['bot', 'item', 'list', '--bot', textos.bob, '--status', 'done,canceled'], 'items', servidor,
    )
    const lenta = { en: ahora(), bots, trabajos, automatizaciones, cerrados }
    // Si falla la lista de bots o de automatizaciones no se cachea: la siguiente ronda reintenta.
    if (signal.aborted || bots.fallo || automatizaciones.fallo) lentas.delete(id)
    else lentas.set(id, lenta)
    return lenta
  }

  async function otrasHost(servidor?: Entorno): Promise<CapturaHost> {
    const { bots, trabajos, automatizaciones, cerrados } = await lentaHost(servidor)
    // Sin bots no hay inicios que buscar; sin consultar tampoco cuenta como fuente disponible.
    const agentes = bots.filas.length ? await consultar(['agent', 'list'], 'agents', servidor) : undefined
    const nombres = new Set(bots.filas.map(({ name }) => name))
    const iniciosBots: Fuente | undefined = agentes && {
      ...agentes,
      filas: agentes.filas.flatMap((agente) => agente.kind === 'chat' && nombres.has(agente.workspace) &&
        texto(agente.worktreeId)?.startsWith('folder:') ? [{
          bot: agente.workspace, displayName: agente.workspace, worktreeId: agente.worktreeId,
          hostId: agente.hostId, botHome: true, agents: [{
            agent: agente.agent, state: agente.state, updatedAt: agente.updatedAt,
            orcaSessionId: agente.orcaSessionId, paneKey: agente.paneKey,
          }],
        }] : []),
    }
    const pendientes = await consultar(
      ['bot', 'item', 'list', '--bot', textos.bob, '--status', 'needs_you'], 'items', servidor, true,
    )
    const mensajes = await consultar(['orchestration', 'inbox', '--limit', '100', '--full'], 'messages', servidor)
    // shortcut: la lista llega de más nuevo a más viejo; si la página acaba en un worker liberado hace más de 24 h
    // (que el grafo ya descarta) no se pide la siguiente. Retenidos muy antiguos pueden quedar fuera.
    const workers = await consultar(['orchestration', 'worker-list', '--full'], 'workers', servidor, true, false,
      (pagina) => {
        const fin = fecha(objeto(pagina.at(-1)?.resource).releaseCompletedAt)
        return fin !== null && ahora() - fin >= DIA_MS
      })
    await completarWorkers(workers, servidor)
    for (const mensaje of mensajes.filas) {
      for (const campo of ['from_handle', 'to_handle']) {
        const handle = texto(mensaje[campo])
        if (handle?.startsWith('run:')) {
          mensaje[campo] = propietarios.get(`${servidor?.id ?? LOCAL}:${handle.slice(4)}`) ?? handle
        }
      }
    }
    return { bots, trabajos, iniciosBots, pendientes, cerrados, mensajes, automatizaciones, workers }
  }

  async function porServidor(consultarHost: (servidor: Entorno) => Promise<CapturaHost>) {
    const capturas: Record<string, CapturaHost> = Object.create(null)
    for (const servidor of servidores) {
      if (signal.aborted) break
      capturas[servidor.id] = await consultarHost(servidor)
    }
    return capturas
  }

  return {
    async otras(visible: AbortSignal = vida): Promise<Captura> {
      signal = AbortSignal.any([vida, visible])
      if (!entornos || ahora() - entornosEn >= LENTA_MS) {
        const listado = await consultar(['environment', 'list'], 'environments')
        entornos = listado.fallo ? { ...listado, filas: entornos?.filas ?? [] } : listado
        entornosEn = listado.fallo ? 0 : ahora()
      }
      servidores = entornosGuardados(entornos)
      entornos.filas = servidores.map(({ id, nombre }) => ({ id, name: nombre }))
      const local = await otrasHost()
      return { ...local, entornos, remotasOtras: await porServidor(otrasHost) }
    },
  }
}
