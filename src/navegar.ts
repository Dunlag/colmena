import { lstat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { LOCAL, objeto } from './datos'
import { enfocarTerminalRemoto } from './fuentes'
import type { Nodo } from './normalizar'
import { textos } from './textos'

const ARCHIVO = 'Colmena.colmena'

export async function abrirColmena(host: OrcaWorkerApi['host']): Promise<{ error?: string }> {
  try {
    const contexto = await host.call('workspace.readContext')
    const { workspaces } = await host.call('workspace.list')
    const espacio = workspaces.find(({ id, hostId, path }) =>
      id === contexto?.workspaceId && (!hostId || hostId === LOCAL) && isAbsolute(path))
    if (!espacio) return { error: textos.faltaEspacioLocal }

    const archivo = join(espacio.path, ARCHIVO)
    try {
      await writeFile(archivo, `${textos.enlaceColmena}\n`, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (objeto(error).code !== 'EEXIST' || !(await lstat(archivo)).isFile()) throw error
    }
    await host.call('editor.open', { workspaceId: espacio.id, path: ARCHIVO })
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
