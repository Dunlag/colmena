import type { Grafo } from './normalizar'

export const LATIDO_VISTA_MS = 10_000
export const VIGENCIA_VISTA_MS = 3 * LATIDO_VISTA_MS

declare module 'orca' {
  interface PluginRequests {
    'vista.visible': { input: { visible: boolean }; output: Record<string, never> }
    'grafo.obtener': { output: Grafo }
    'colmena.abrir': { output: { error?: string } }
    'nodo.abrir': { input: { id: string }; output: { error?: string } }
  }

  interface PluginPanelEvents {
    'grafo.actualizado': Grafo
  }
}
