import { clave, enMaquina, fecha, objeto, texto, type Fuente } from './datos'

const MODELO_CORTO = new Set(['codex', 'cursor', 'grok', 'gemini', 'opencode'])
const OPCIONES_CON_VALOR = new Set([
  '-c', '--config', '--effort', '--add-dir', '--prompt', '--system-prompt', '--append-system-prompt',
])

function argumentos(comando: string): string[] {
  const tokens: string[] = []
  let comilla = ''
  let token = ''
  let iniciado = false
  for (let i = 0; i < comando.length; i++) {
    const caracter = comando[i]
    const siguiente = comando[i + 1]
    if (!comilla && (';|&<>()\n'.includes(caracter) || (caracter === '#' && !iniciado))) break
    if (!comilla && /\s/.test(caracter)) {
      if (iniciado) tokens.push(token)
      token = ''
      iniciado = false
      continue
    }
    iniciado = true
    if (caracter === comilla) comilla = ''
    else if (!comilla && (caracter === '"' || caracter === "'")) comilla = caracter
    else if (caracter === '\\' && siguiente === '\n' && comilla !== "'") i++
    else if (caracter === '\\' && siguiente && (!comilla
      ? /[\s"'\\;$&|<>()#]/.test(siguiente)
      : comilla === '"' && /["\\$`]/.test(siguiente))) token += comando[++i]
    else token += caracter
  }
  if (comilla) return []
  if (iniciado) tokens.push(token)
  return tokens
}

export function leerModelo(comando: string, agenteOrca?: string): { agente: string; modelo: string | null } | null {
  const tokens = argumentos(comando)
  const ejecutable = tokens.findIndex((token) => token !== 'env' && token !== 'exec' && !/^[\w]+=.*/.test(token))
  if (ejecutable === -1) return null
  const binario = tokens[ejecutable].split(/[/\\]/).at(-1)?.replace(/\.(?:exe|cmd|bat)$/i, '')
  const agente = texto(agenteOrca, binario)
  if (!agente) return null
  const corto = MODELO_CORTO.has(agente)
  let modelo: string | null = null
  for (let i = ejecutable + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--') break
    if (token.startsWith('--model=') || (corto && token.startsWith('-m='))) {
      modelo = texto(token.slice(token.indexOf('=') + 1))
    } else if (token === '--model' || (corto && token === '-m')) {
      const valor = tokens[i + 1]
      if (valor !== undefined && !valor.startsWith('-')) modelo = texto(tokens[++i])
    } else if (OPCIONES_CON_VALOR.has(token) && tokens[i + 1] !== '--') {
      i++
    }
  }
  return { agente, modelo }
}

export const CLAVE_MODELOS = 'modelosPorTerminal'
export const DIA_MS = 86_400_000

export type RegistroModelo = {
  agente: string
  modelo: string | null
  maquina: string
  desde: number
}

export type Modelos = Record<string, RegistroModelo>

type Inventario = { base: string; fuente: Fuente }

export function inventarioTerminales({ base, fuente }: Inventario) {
  const presentes = new Set<string>()
  const porPanel = new Map<string, string[]>()
  for (const fila of fuente.filas) {
    const maquina = enMaquina(texto(fila.executionHostId), base)
    const tab = texto(fila.tabId)
    const hoja = texto(fila.leafId)
    const panel = tab && hoja && `${tab}:${hoja}`
    const ids = [texto(fila.handle), texto(fila.ptyId), panel].filter((id) => id !== null)
    for (const id of ids) presentes.add(clave(maquina, id))
    if (panel) porPanel.set(clave(maquina, panel), ids)
  }
  const cubiertas = new Set(fuente.fallo ? [] : (fuente.hosts ?? [base]).map((host) => enMaquina(host, base)))
  return { presentes, porPanel, cubiertas }
}

export function depurarModelos(
  guardado: unknown, ahora: number, inventarios: readonly Inventario[] = [], consultado = ahora,
): Modelos {
  const modelos: Modelos = Object.create(null)
  const inventario = inventarios.map(inventarioTerminales)
  for (const [llave, valor] of Object.entries(objeto(guardado))) {
    const fila = objeto(valor)
    const agente = texto(fila.agente)
    const maquina = texto(fila.maquina)
    const desde = fecha(fila.desde)
    if (!agente || !maquina || desde === null || ahora - desde >= DIA_MS) continue
    if (desde < consultado && inventario.some(({ presentes, cubiertas }) =>
      cubiertas.has(maquina) && !presentes.has(llave))) continue
    modelos[llave] = { agente, maquina, desde, modelo: texto(fila.modelo) }
  }
  return modelos
}
