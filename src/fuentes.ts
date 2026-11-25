import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { filas, objeto, texto, type Captura, type FalloFuente, type Fuente, type Fila } from './datos'
import { textos } from './textos'

const LIMITE_MS = 2500

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
  return new Promise((resolve, reject) => {
    execFile(ejecutable(), argumentos, {
      env, signal, timeout: LIMITE_MS, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8', windowsHide: true,
    }, (error, stdout) => {
      if (error && (error.killed || !stdout.trim())) reject(error)
      else resolve(stdout)
    })
  })
}

export type Ejecutar = typeof ejecutar

export function lector(signal: AbortSignal, comando: Ejecutar = ejecutar) {
  async function consultar(argumentos: string[], campo: string, paginar = false, antes?: () => Promise<void>): Promise<Fuente> {
    const fuente = argumentos.join(' ')
    const acumuladas: Fila[] = []
    const cursores = new Set<string>()
    let cursor: string | null = null
    let items: Fila[] | undefined
    let fallo: FalloFuente | undefined

    do {
      await antes?.()
      if (signal.aborted) break
      try {
        const pagina: Fila = objeto(JSON.parse(await comando([
          ...argumentos, ...(cursor ? ['--cursor', cursor] : []), '--json',
        ], signal)))
        const error = objeto(pagina.error)
        if (pagina.ok === false) {
          return { filas: acumuladas, fallo: {
            fuente, codigo: texto(error.code) ?? 'cli', mensaje: textos.falloConsulta,
          } }
        }
        const resultado = objeto(pagina.result)
        if (pagina.ok !== true || !Array.isArray(resultado[campo])) throw new SyntaxError()
        acumuladas.push(...filas(resultado[campo]))
        if (campo === 'workspaces') items = filas(resultado.items)
        const omitidos = objeto(resultado.hostScope).omittedHostIds
        if (resultado.truncated === true || (Array.isArray(omitidos) && omitidos.length > 0) ||
            filas(resultado.unreachable).length > 0 || filas(resultado.partialHostErrors).length > 0) {
          fallo = { fuente, codigo: 'parcial', mensaje: textos.parcial }
        }
        cursor = paginar ? texto(objeto(resultado.page).nextCursor, resultado.nextCursor) : null
        if (cursor && cursores.has(cursor)) throw new SyntaxError()
        if (cursor) cursores.add(cursor)
      } catch (error) {
        const invalida = error instanceof SyntaxError
        const vencido = objeto(error).killed === true
        return { filas: acumuladas, fallo: {
          fuente,
          codigo: invalida ? 'json' : vencido ? 'timeout' : texto(objeto(error).code) ?? 'cli',
          mensaje: invalida ? textos.respuestaInvalida : vencido ? textos.tiempoAgotado : textos.falloConsulta,
        } }
      }
    } while (cursor)

    return { filas: acumuladas, items, fallo }
  }

  return {
    async vivas(): Promise<Captura> {
      const worktrees = await consultar(['worktree', 'ps', '--limit', '100'], 'worktrees')
      const workers = await consultar(['orchestration', 'worker-list', '--include-remote', '--full'], 'workers', true)
      return { worktrees, workers }
    },

    async otras(antes?: () => Promise<void>): Promise<Captura> {
      const bots = await consultar(['bot', 'list'], 'bots', false, antes)
      const trabajos: Record<string, Fuente> = Object.create(null)
      for (const bot of bots.filas) {
        const nombre = texto(bot.name)
        const id = texto(bot.id) ?? nombre
        const servidor = texto(objeto(bot.server).on)
        if (nombre && id && !Object.hasOwn(trabajos, id)) {
          const entorno = servidor ? ['--environment', servidor] : []
          trabajos[id] = await consultar(['bot', 'work', 'list', '--bot', nombre, ...entorno], 'workspaces', false, antes)
        }
      }
      const pendientes = await consultar(['bot', 'item', 'list', '--bot', textos.bob, '--status', 'needs_you'], 'items', true, antes)
      const mensajes = await consultar(['orchestration', 'inbox', '--full'], 'messages', false, antes)
      const automatizaciones = await consultar(['automations', 'list'], 'automations', false, antes)
      return { bots, trabajos, pendientes, mensajes, automatizaciones }
    },
  }
}
