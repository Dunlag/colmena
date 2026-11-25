import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  entornosGuardados, filas, LOCAL, maquinaRemota, objeto, texto,
  type Captura, type CapturaHost, type Entorno, type FalloFuente, type Fuente, type Fila,
} from './datos'
import { textos } from './textos'

const LIMITE_MS = 2500
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

export function lector(signal: AbortSignal, comando: Ejecutar = ejecutar) {
  let entornos: Fuente | undefined
  let servidores: Entorno[] = []

  async function consultar(
    argumentos: string[], campo: string, servidor?: Entorno, paginar = false, antes?: () => Promise<void>,
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
      await antes?.()
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
        if (pagina.ok !== true || !Array.isArray(resultado[campo])) throw new SyntaxError()
        acumuladas.push(...filas(resultado[campo]))
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
        cursor = paginar ? texto(objeto(resultado.page).nextCursor, resultado.nextCursor) : null
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

  async function vivasHost(servidor?: Entorno): Promise<CapturaHost> {
    const worktrees = await consultar(['worktree', 'ps', '--limit', '100'], 'worktrees', servidor)
    const workers = await consultar(['orchestration', 'worker-list', '--full'], 'workers', servidor, true)
    const terminales = await consultar(['terminal', 'list', '--limit', '1000'], 'terminals', servidor)
    // Se conserva únicamente lo necesario para enlazar y depurar los modelos.
    terminales.filas = terminales.filas.map(({ handle, ptyId, tabId, leafId, executionHostId }) =>
      ({ handle, ptyId, tabId, leafId, executionHostId }))
    return { worktrees, workers, terminales }
  }

  async function otrasHost(servidor?: Entorno, antes?: () => Promise<void>): Promise<CapturaHost> {
    const bots = await consultar(['bot', 'list'], 'bots', servidor, false, antes)
    bots.filas = bots.filas.filter((bot) => !bot.server)
    const trabajos: Record<string, Fuente> = Object.create(null)
    for (const bot of bots.filas) {
      const nombre = texto(bot.name)
      const id = texto(bot.id) ?? nombre
      if (nombre && id && !Object.hasOwn(trabajos, id)) {
        trabajos[id] = await consultar(['bot', 'work', 'list', '--bot', nombre], 'workspaces', servidor, false, antes)
      }
    }
    const pendientes = await consultar(
      ['bot', 'item', 'list', '--bot', textos.bob, '--status', 'needs_you'], 'items', servidor, true, antes,
    )
    const mensajes = await consultar(['orchestration', 'inbox', '--full'], 'messages', servidor, false, antes)
    const automatizaciones = await consultar(['automations', 'list'], 'automations', servidor, false, antes)
    return { bots, trabajos, pendientes, mensajes, automatizaciones }
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
    async vivas(): Promise<Captura> {
      const listado = await consultar(['environment', 'list'], 'environments')
      entornos = listado.fallo ? { ...listado, filas: entornos?.filas ?? [] } : listado
      servidores = entornosGuardados(entornos)
      // El grafo solo necesita el selector estable y la etiqueta del servidor.
      entornos.filas = servidores.map(({ id, nombre }) => ({ id, name: nombre }))
      const local = await vivasHost()
      return { ...local, entornos, remotasVivas: await porServidor(vivasHost) }
    },

    async otras(antes?: () => Promise<void>): Promise<Captura> {
      const local = await otrasHost(undefined, antes)
      return { ...local, remotasOtras: await porServidor((servidor) => otrasHost(servidor, antes)) }
    },
  }
}
