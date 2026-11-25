import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OrcaWorkerApi } from 'orca/worker'
import { LOCAL, objeto } from './datos'
import { enfocarTerminalRemoto } from './fuentes'
import type { Nodo } from './normalizar'
import { textos } from './textos'

const ARCHIVO = 'Colmena.colmena'

const ENLACE_PROPIO = new URL('../.orca/Colmena.colmena', import.meta.url)

export async function abrirColmena(
  host: OrcaWorkerApi['host'], archivoPropio = fileURLToPath(ENLACE_PROPIO),
): Promise<{ error?: string }> {
  try {
    const { workspaces } = await host.call('workspace.list')
    const locales = workspaces.filter(({ hostId, path }) => (!hostId || hostId === LOCAL) && isAbsolute(path))
    const contenedor = locales.filter(({ path }) => {
      const ruta = relative(path, archivoPropio)
      return ruta && !isAbsolute(ruta) && ruta !== '..' && !ruta.startsWith(`..${sep}`)
    }).sort((a, b) => b.path.length - a.path.length || a.id.localeCompare(b.id))[0]
    const bob = locales.find(({ path, kind }) => kind === 'folder' &&
      basename(path).toLowerCase() === 'bob' && basename(dirname(path)) === 'bots')
    const espacio = contenedor ?? bob
    if (!espacio) return { error: textos.faltaEspacioLocal }

    const archivo = contenedor ? archivoPropio : join(espacio.path, '.colmena', ARCHIVO)
    await mkdir(dirname(archivo), { recursive: true, mode: 0o700 })
    try {
      await writeFile(archivo, `${textos.enlaceColmena}\n`, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (objeto(error).code !== 'EEXIST' || !(await lstat(archivo)).isFile()) throw error
    }
    await host.call('editor.open', { workspaceId: espacio.id, path: relative(espacio.path, archivo).split(sep).join('/') })
    await host.call('workspace.open', { workspaceId: espacio.id })
    return {}
  } catch {
    return { error: textos.falloAbrirColmena }
  }
}

export async function abrirNodo(
  host: OrcaWorkerApi['host'], signal: AbortSignal, nodo?: Nodo,
): Promise<{ error?: string }> {
  const destino = nodo?.destino
  if (!destino) return { error: textos.sinDestino }

  const servidor = /^runtime:([^/]+)/.exec(nodo.maquina)
  if (servidor) {
    if (!destino.terminalId) return { error: textos.sinDestino }
    try {
      if (await enfocarTerminalRemoto(destino.terminalId, decodeURIComponent(servidor[1]), signal)) return {}
    } catch {
      return { error: textos.falloAbrirNodo }
    }
    return { error: textos.falloAbrirNodo }
  }

  if (destino.terminalId && host.has('terminal.focus')) {
    try {
      const resultado = await host.call('terminal.focus', { terminalId: destino.terminalId })
      return resultado.focused ? {} : { error: textos.falloAbrirNodo }
    } catch {
      // Un terminal cerrado puede conservar su espacio.
    }
  }
  if (destino.workspaceId) {
    try {
      await host.call('workspace.open', { workspaceId: destino.workspaceId })
      return {}
    } catch {
      return { error: textos.falloAbrirNodo }
    }
  }
  return { error: textos.falloAbrirNodo }
}
