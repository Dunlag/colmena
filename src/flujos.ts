import type { Arista } from './normalizar'

export const VENTANA_FLUJO_MS = 30_000

export type Mensaje = Arista & { tipo: 'mensaje'; hora: number }

export function mensajes(aristas: readonly Arista[]): Mensaje[] {
  return aristas.filter((arista): arista is Mensaje =>
    arista.tipo === 'mensaje' && Number.isFinite(arista.hora))
    .sort((a, b) => b.hora - a.hora)
}

export function ultimos30Segundos(entradas: readonly Mensaje[], ahora: number): Mensaje[] {
  return entradas.filter(({ hora }) => hora <= ahora && ahora - hora < VENTANA_FLUJO_MS)
}
