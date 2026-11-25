export type Fila = Record<string, unknown>

export type FalloFuente = {
  fuente: string
  codigo: string
  mensaje: string
}

export type Fuente = { filas: Fila[]; items?: Fila[]; fallo?: FalloFuente }

export type Captura = {
  bots?: Fuente
  trabajos?: Record<string, Fuente>
  pendientes?: Fuente
  worktrees?: Fuente
  workers?: Fuente
  mensajes?: Fuente
  automatizaciones?: Fuente
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
