// Aspecto común de la pestaña (HTML + pestana.css) y del panel (componentes de Orca).
import type { IconName, Tone } from 'orca'
import { tipoMensaje, type Mensaje } from './flujos'
import type { Nodo, Situacion, TipoMensaje } from './normalizar'
import { textos } from './textos'

/** Los tonos de pestana.css ([data-tono]) y su equivalente entre los cinco de un panel de componentes. */
export const TONO_ORCA = {
  verde: 'success', azul: 'accent', ambar: 'warning', rojo: 'danger', neutro: 'neutral',
} as const satisfies Record<string, Tone>
export type TonoPestana = keyof typeof TONO_ORCA

// shortcut: el panel no tiene turquesa, violeta ni ciruela; tú, Bob y encargo van en accent hasta que el panel sea HTML.
export const tipos = {
  tu: { etiqueta: textos.usuario, iconoOrca: 'bell', tono: 'accent',
    icono: 'M9 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 15v-1a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1' },
  bob: { etiqueta: textos.coordinador, iconoOrca: 'star', tono: 'accent',
    icono: 'M3 5l3 3 3-5 3 5 3-3-1.5 7h-9ZM5 15h8' },
  bot: { etiqueta: textos.bot, iconoOrca: 'bot', tono: 'accent',
    icono: 'M9 3v3M6 11h.1m5.8 0h.1M4 6h10a1 1 0 0 1 1 1v7H3V7a1 1 0 0 1 1-1ZM1.5 10v2m15-2v2' },
  worker: { etiqueta: textos.worker, iconoOrca: 'terminal', tono: 'success',
    icono: 'M3 4h12v10H3ZM6 7l2 2-2 2m4 0h2' },
  automatizacion: { etiqueta: textos.automatizacion, iconoOrca: 'calendar', tono: 'warning',
    icono: 'M15 9a6 6 0 1 0-6 6h2m-2-9v3l2 1m1 4 2-2 2 2' },
  grupo: { etiqueta: textos.terminado, iconoOrca: 'layers', tono: 'neutral', icono: 'M3 6h12M3 9h12M3 12h12' },
  maquina: { etiqueta: textos.maquina, iconoOrca: 'gauge', tono: 'neutral', icono: 'M3 4h12v8H3Zm4 11h4m-2-3v3' },
} satisfies Record<Nodo['tipo'], { etiqueta: string; icono: string; iconoOrca: IconName; tono: Tone }>

export const estados: Record<Situacion, { etiqueta: string; tono: TonoPestana }> = {
  trabajando: { etiqueta: textos.trabajando, tono: 'verde' },
  esperando: { etiqueta: textos.esperando, tono: 'azul' },
  terminado: { etiqueta: textos.terminado, tono: 'neutro' },
}

export function tono(nodo: Nodo): TonoPestana {
  if (nodo.tipo === 'tu' && nodo.pendientes?.length) return 'ambar'
  if (nodo.estado === textos.fallido) return 'rojo'
  if (nodo.estado === textos.bloqueado) return 'ambar'
  return estados[nodo.situacion].tono
}

export function tonoNodo(nodo: Nodo): Tone {
  return TONO_ORCA[tono(nodo)]
}

/** [data-mensaje] de pestana.css en los tonos del panel. */
export const tonoMensaje: Record<TipoMensaje, Tone> = {
  encargo: 'accent', pregunta: 'warning', estado: 'neutral', resultado: 'neutral',
}

export function tonoFlujo(mensaje: Mensaje): Tone {
  return tonoMensaje[tipoMensaje(mensaje)]
}
