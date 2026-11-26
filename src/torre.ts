import type { Tone } from 'orca'
import { mensajes, tipoMensaje, type Mensaje } from './flujos'
import type { Grafo, Nodo, TipoMensaje } from './normalizar'
import { textos } from './textos'

export const MINUTOS_ATASCO = 20
const MINUTO_MS = 60_000

/** Medianoche local del día de `ahora`. */
export function medianoche(ahora: number): number {
  const dia = new Date(ahora)
  dia.setHours(0, 0, 0, 0)
  return dia.getTime()
}

export function resumenDia(grafo: Grafo, ahora: number) {
  const desde = medianoche(ahora)
  return {
    terminados: grafo.nodos.filter((nodo) =>
      nodo.tipo === 'worker' && nodo.situacion === 'terminado' && (nodo.desde ?? 0) >= desde).length,
    mensajes: mensajes(grafo.aristas).filter(({ hora }) => hora >= desde).length,
    cerrados: grafo.cierres.filter((hora) => hora >= desde).length,
  }
}

export type Atasco = { nodo: Nodo; motivo: 'permiso' | 'parado' | 'fallado' }

export function atascos(grafo: Grafo, ahora: number, minutos = MINUTOS_ATASCO): Atasco[] {
  const hoy = medianoche(ahora)
  return grafo.nodos.flatMap((nodo): Atasco[] => {
    if (nodo.tipo !== 'worker') return []
    if (nodo.estado === textos.fallido) return (nodo.desde ?? 0) >= hoy ? [{ nodo, motivo: 'fallado' }] : []
    if (nodo.situacion === 'terminado') return []
    if (nodo.estado === textos.bloqueado) return [{ nodo, motivo: 'permiso' }]
    return nodo.desde !== null && ahora - nodo.desde > minutos * MINUTO_MS ? [{ nodo, motivo: 'parado' }] : []
  })
}

/** "en 13 h" hasta `hora`; nunca en negativo. */
export function cuentaAtras(hora: number, ahora: number): string {
  const minutos = Math.max(0, Math.round((hora - ahora) / MINUTO_MS))
  if (minutos < 1) return textos.ahora
  if (minutos < 60) return textos.enTiempo(minutos, 'min')
  const horas = Math.round(minutos / 60)
  return horas < 48 ? textos.enTiempo(horas, 'h') : textos.enTiempo(Math.round(horas / 24), 'd')
}

export function proximas(grafo: Grafo, limite = 4): (Nodo & { proxima: number })[] {
  return grafo.nodos
    .filter((nodo): nodo is Nodo & { proxima: number } => nodo.tipo === 'automatizacion' && !!nodo.proxima)
    .sort((a, b) => a.proxima - b.proxima)
    .slice(0, limite)
}

/** La API de plugins no abre items: el clic de un item de la cola va al chat de Bob. */
export function destinoItem(grafo: Grafo): string | undefined {
  return grafo.nodos.find((nodo) => nodo.tipo === 'bob' && nodo.maquina === 'local')?.id ??
    grafo.nodos.find((nodo) => nodo.tipo === 'bob')?.id
}

export type GrupoBot = { bot: Nodo | null; workers: Nodo[] }

/** Workers no terminados bajo el bot que los lanzó (subiendo por workers coordinadores). */
export function activosPorBot(grafo: Grafo): GrupoBot[] {
  const porId = new Map(grafo.nodos.map((nodo) => [nodo.id, nodo]))
  const padre = new Map<string, string>()
  for (const arista of grafo.aristas) {
    if (arista.tipo === 'lanzamiento' && !padre.has(arista.destino)) padre.set(arista.destino, arista.origen)
  }
  function botDe(id: string): Nodo | null {
    const vistos = new Set<string>()
    for (let actual = padre.get(id); actual && !vistos.has(actual); actual = padre.get(actual)) {
      vistos.add(actual)
      const nodo = porId.get(actual)
      if (nodo?.tipo === 'bot' || nodo?.tipo === 'bob') return nodo
    }
    return null
  }
  const grupos = new Map<string | null, GrupoBot>()
  for (const nodo of grafo.nodos) {
    if (nodo.tipo === 'bot' || nodo.tipo === 'bob') grupos.set(nodo.id, { bot: nodo, workers: [] })
  }
  for (const nodo of grafo.nodos) {
    if (nodo.tipo !== 'worker' || nodo.situacion === 'terminado') continue
    const bot = botDe(nodo.id)
    const grupo = grupos.get(bot?.id ?? null) ?? { bot, workers: [] }
    grupo.workers.push(nodo)
    grupos.set(bot?.id ?? null, grupo)
  }
  return [...grupos.values()].sort((a, b) =>
    Number(!a.bot) - Number(!b.bot) || b.workers.length - a.workers.length ||
    (a.bot?.nombre ?? '').localeCompare(b.bot?.nombre ?? ''))
}

export function ultimosFlujos(grafo: Grafo, limite = 5): Mensaje[] {
  return mensajes(grafo.aristas).slice(0, limite)
}

// Los mismos colores que la pestaña, en los cinco tonos que dibuja un panel de componentes.
export const tonoMensaje: Record<TipoMensaje, Tone> = {
  encargo: 'accent', pregunta: 'warning', estado: 'neutral', resultado: 'success',
}

export function tonoFlujo(mensaje: Mensaje): Tone {
  return tonoMensaje[tipoMensaje(mensaje)]
}

export function tonoNodo(nodo: Nodo): Tone {
  if (nodo.estado === textos.fallido) return 'danger'
  if (nodo.estado === textos.bloqueado) return 'warning'
  return nodo.situacion === 'trabajando' ? 'success' : nodo.situacion === 'esperando' ? 'accent' : 'neutral'
}
