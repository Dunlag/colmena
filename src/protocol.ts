import type { Grafo } from './normalizar'

declare module 'orca' {
  interface PluginRequests {
    'grafo.obtener': { output: Grafo }
  }

  interface PluginPanelEvents {
    'grafo.actualizado': Grafo
  }
}
