import { atom, Button, plugin, read, set, Stack, Text, type PanelContext } from 'orca'
import type { Grafo } from './normalizar'
import { textos } from './textos'

const grafo = atom<Grafo | null>(null)
const fallo = atom(false)
const errorApertura = atom<string | undefined>(undefined)
const abriendo = atom(false)

async function abrir() {
  if (read(abriendo)) return
  set(abriendo, true)
  set(errorApertura, undefined)
  try {
    set(errorApertura, (await plugin.request('colmena.abrir')).error)
  } catch {
    set(errorApertura, textos.falloAbrirColmena)
  } finally {
    set(abriendo, false)
  }
}

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
  return (
    <Stack gap="xs">
      <Button icon="file-text" disabled={read(abriendo)} onPress={abrir}>{textos.abrirColmena}</Button>
      {read(errorApertura) && <Text>{read(errorApertura)}</Text>}
      <Text>{actual ? textos.recuento(actual.nodos.length, actual.aristas.length) :
        read(fallo) ? textos.falloPanel : textos.consultando}</Text>
      {!!actual?.fallos.length && <Text>{textos.errores(actual.fallos.length)}</Text>}
    </Stack>
  )
}
