import type { Grafo } from './normalizar'

declare module 'orca' {
  interface PluginRequests {
    'grafo.obtener': { output: Grafo }
    'colmena.abrir': { output: { error?: string } }
    'nodo.abrir': { input: { id: string }; output: { error?: string } }
  }

  interface PluginPanelEvents {
    'grafo.actualizado': Grafo
  }
}
