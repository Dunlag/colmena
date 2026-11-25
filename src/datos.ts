export type Fila = Record<string, unknown>
export const LOCAL = 'local'

export function clave(maquina: string, id: string): string {
  return JSON.stringify([maquina, id])
}

export type FalloFuente = {
  maquina: string
  fuente: string
  codigo: string
  mensaje: string
}

export type Fuente = { filas: Fila[]; items?: Fila[]; hosts?: string[]; fallo?: FalloFuente }

export type CapturaHost = {
  bots?: Fuente
  trabajos?: Record<string, Fuente>
  pendientes?: Fuente
  worktrees?: Fuente
  workers?: Fuente
  terminales?: Fuente
  mensajes?: Fuente
  automatizaciones?: Fuente
}

export type Entorno = { id: string; nombre: string }
export type Captura = CapturaHost & {
  entornos?: Fuente
  remotasVivas?: Record<string, CapturaHost>
  remotasOtras?: Record<string, CapturaHost>
}

export function entornosGuardados(fuente?: Fuente): Entorno[] {
  const entornos = new Map<string, Entorno>()
  for (const fila of fuente?.filas ?? []) {
    const id = texto(fila.id)
    const nombre = texto(fila.name)
    if (id && id !== LOCAL && nombre) entornos.set(id, { id, nombre })
  }
  return [...entornos.values()]
}

export function maquinaRemota(id: string): string {
  return `runtime:${encodeURIComponent(id)}`
}

export function enMaquina(host: string | null, base: string): string {
  if (!host || host === LOCAL || host === base) return base
  return base === LOCAL ? host : `${base}/${host}`
}

export function objeto(valor: unknown): Fila {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Fila : {}
}

export function filas(valor: unknown): Fila[] {
  return Array.isArray(valor)
    ? valor.filter((fila): fila is Fila => Boolean(fila && typeof fila === 'object' && !Array.isArray(fila)))
    : []
}

export function texto(...valores: unknown[]): string | null {
  for (const valor of valores) {
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
  }
  return null
}

export function fecha(...valores: unknown[]): number | null {
  for (const valor of valores) {
    const ms = typeof valor === 'number' ? valor : typeof valor === 'string' ? Date.parse(valor) : NaN
    if (Number.isFinite(ms) && ms > 0) return ms
  }
  return null
}
