import { atom, plugin, read, set, Stack, Text, type PanelContext } from 'orca'
import type { Grafo } from './normalizar'
import { textos } from './textos'

const grafo = atom<Grafo | null>(null)
const fallo = atom(false)

export function setup(ctx: PanelContext): void {
  function actualizar(valor: Grafo) {
    if (ctx.signal.aborted) return
    if (valor.generado >= (read(grafo)?.generado ?? 0)) set(grafo, valor)
    set(fallo, false)
  }

  ctx.subscriptions.push(plugin.on('grafo.actualizado', actualizar))
  void plugin.request('grafo.obtener', undefined, { signal: ctx.signal }).then(actualizar, () => {
    if (!ctx.signal.aborted && !read(grafo)) set(fallo, true)
  })
}

export default function Panel() {
  const actual = read(grafo)
  if (!actual) return <Text>{read(fallo) ? textos.falloPanel : textos.consultando}</Text>

  return (
    <Stack gap="xs">
      <Text>{textos.recuento(actual.nodos.length, actual.aristas.length)}</Text>
      {actual.fallos.length > 0 && <Text>{textos.errores(actual.fallos.length)}</Text>}
    </Stack>
  )
}
