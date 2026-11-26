import {
  atom, Box, Heading, IconButton, List, ListItem, plugin, read, RelativeTime, Row, Select, set, Stack, Text,
  type PanelContext, type Tone,
} from 'orca'
import type { Grafo, Nodo } from './normalizar'
import { LATIDO_VISTA_MS } from './protocol'
import { traducirAsunto, textos } from './textos'
import {
  activosPorBot, atascos, cuentaAtras, destinoItem, MINUTOS_ATASCO, proximas, resumenDia, tonoFlujo, tonoNodo,
  ultimosFlujos,
} from './torre'

const grafo = atom<Grafo | null>(null)
const fallo = atom(false)
const errorApertura = atom<string | undefined>(undefined)
const abriendo = atom(false)
// Reloj al minuto para atascos y cuentas atrás; el tiempo de cada worker lo mantiene RelativeTime sin sondeo.
const reloj = atom(Date.now())
// En storage y no en settings: declarar un ajuste cambiaría las contribuciones del manifest.
const minutosAtasco = atom('minutosAtasco', MINUTOS_ATASCO, { persist: 'storage' })

const horaCorta = new Intl.DateTimeFormat(textos.idioma, { hour: 'numeric', minute: '2-digit' })
const diaCorto = new Intl.DateTimeFormat(textos.idioma, { day: 'numeric', month: 'short' })

function fechaCorta(hora: number, ahora: number): string {
  return new Date(hora).toDateString() === new Date(ahora).toDateString() ? horaCorta.format(hora) : diaCorto.format(hora)
}

function nombreConHora(nombre: string, hora: number): string {
  const texto = horaCorta.format(hora)
  return nombre.includes(texto) ? nombre : `${nombre} ${texto}`
}

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

async function abrirNodo(id: string | undefined) {
  if (!id) return set(errorApertura, textos.sinDestino)
  set(errorApertura, undefined)
  try {
    set(errorApertura, (await plugin.request('nodo.abrir', { id })).error)
  } catch {
    set(errorApertura, textos.falloAbrirNodo)
  }
}

export function setup(ctx: PanelContext): void {
  function actualizar(valor: Grafo) {
    if (ctx.signal.aborted) return
    if (valor.generado >= (read(grafo)?.generado ?? 0)) set(grafo, valor)
    set(fallo, false)
  }

  const documento = typeof document === 'undefined' ? undefined : document
  let avisado = false
  function notificar(visible: boolean) {
    if (!visible && !avisado) return
    avisado = visible
    void plugin.request('vista.visible', { visible }).catch(() => {})
  }
  function comprobarVisibilidad() {
    const visible = read(ctx.visible) && (!documento || documento.visibilityState === 'visible')
    notificar(visible)
    const minuto = Math.floor(Date.now() / 60_000)
    if (visible && minuto !== Math.floor(read(reloj) / 60_000)) set(reloj, Date.now())
  }
  comprobarVisibilidad()
  const latido = setInterval(comprobarVisibilidad, LATIDO_VISTA_MS)
  documento?.addEventListener('visibilitychange', comprobarVisibilidad)
  ctx.subscriptions.push({
    dispose() {
      clearInterval(latido)
      documento?.removeEventListener('visibilitychange', comprobarVisibilidad)
      notificar(false)
    },
  })
  ctx.subscriptions.push(plugin.on('grafo.actualizado', actualizar))
  void plugin.request('grafo.obtener', undefined, { signal: ctx.signal }).then(actualizar, () => {
    if (!ctx.signal.aborted && !read(grafo)) set(fallo, true)
  })
}

function Punto({ tone }: { tone: Tone }) {
  return <Text tone={tone} size="xs">●</Text>
}

function Fila({ tone, titulo, detalle, onPress }: {
  tone: Tone; titulo: string; detalle?: unknown; onPress?: () => unknown
}) {
  const contenido = (
    <Row gap="xs" align="start">
      <Punto tone={tone} />
      <Stack gap="none">
        <Text size="sm" truncate>{titulo}</Text>
        {detalle ? <Text size="xs" muted truncate>{detalle}</Text> : null}
      </Stack>
    </Row>
  )
  return onPress ? <ListItem onPress={onPress}>{contenido}</ListItem> : <ListItem>{contenido}</ListItem>
}

function Bloque({ titulo, children }: { titulo: string; children?: unknown }) {
  return (
    <Stack gap="xs">
      <Text size="xs" weight="semibold" muted>{titulo}</Text>
      {children}
    </Stack>
  )
}

function ahoraDe(actual: Grafo) {
  return Math.max(read(reloj), actual.generado)
}

function resumen(actual: Grafo) {
  const dia = resumenDia(actual, ahoraDe(actual))
  return textos.resumenDia(dia.terminados, dia.mensajes, dia.cerrados)
}

function Torre({ actual }: { actual: Grafo }) {
  const ahora = ahoraDe(actual)
  const minutos = read(minutosAtasco)
  const alertas = atascos(actual, ahora, minutos)
  const cola = actual.nodos.find((nodo) => nodo.tipo === 'tu')?.pendientes ?? []
  const bob = destinoItem(actual)
  const nombreMaquina = (nodo: Nodo) =>
    actual.nodos.find((otro) => otro.id === `maquina:${nodo.maquina}`)?.nombre ?? nodo.maquina
  const detalleWorker = (nodo: Nodo) => (
    <>
      {[nodo.modelo, nombreMaquina(nodo)].filter(Boolean).join(' · ')}
      {nodo.desde !== null && <> · <RelativeTime at={nodo.desde} format="duration" /></>}
    </>
  )
  const flujos = ultimosFlujos(actual)
  const nombre = (id: string) => actual.nodos.find((nodo) => nodo.id === id)?.nombre ?? id
  const automatizaciones = proximas(actual)
  return (
    <Stack gap="md">
      {alertas.length > 0 && (
        <Box border={alertas.some((a) => a.motivo === 'fallado') ? 'danger' : 'warning'} radius="md" padding="xs">
          <Bloque titulo={textos.atascos}>
            <List label={textos.atascos}>
              {alertas.map(({ nodo, motivo }) => (
                <Fila key={nodo.id} tone={motivo === 'fallado' ? 'danger' : 'warning'} titulo={nodo.nombre}
                  detalle={motivo === 'parado' ? textos.motivoAtasco.parado(minutos) : textos.motivoAtasco[motivo]}
                  onPress={() => abrirNodo(nodo.id)} />
              ))}
            </List>
          </Bloque>
        </Box>
      )}

      <Bloque titulo={`${textos.tuCola} · ${cola.length}`}>
        {cola.length ? (
          <List label={textos.tuCola}>
            {cola.map((item) => (
              <Fila key={item.id} tone="warning" titulo={item.tarea}
                detalle={item.desde ? fechaCorta(item.desde, ahora) : textos.sinFecha}
                onPress={() => abrirNodo(bob)} />
            ))}
          </List>
        ) : <Text size="xs" muted>{textos.sinPendientes}</Text>}
      </Bloque>

      <Bloque titulo={textos.workersActivos}>
        <List label={textos.workersActivos}>
          {activosPorBot(actual).flatMap(({ bot, workers }) => [
            bot
              ? <Fila key={bot.id} tone={workers.length ? 'success' : 'neutral'} titulo={bot.nombre}
                  detalle={workers.length ? undefined : textos.enReposo} onPress={() => abrirNodo(bot.id)} />
              : <Fila key="sin-bot" tone="neutral" titulo={textos.sinBot} />,
            ...workers.map((nodo) => (
              <Fila key={nodo.id} tone={tonoNodo(nodo)} titulo={`↳ ${nodo.tarea ? traducirAsunto(nodo.tarea) : nodo.nombre}`}
                detalle={detalleWorker(nodo)} onPress={() => abrirNodo(nodo.id)} />
            )),
          ])}
        </List>
      </Bloque>

      <Bloque titulo={textos.proximasAutomatizaciones}>
        {automatizaciones.length ? (
          <List label={textos.proximasAutomatizaciones}>
            {automatizaciones.map((nodo) => (
              <ListItem key={nodo.id} disabled>
                <Text size="sm" truncate>
                  {`${nombreConHora(nodo.nombre, nodo.proxima)} · ${cuentaAtras(nodo.proxima, ahora)}`}
                </Text>
              </ListItem>
            ))}
          </List>
        ) : <Text size="xs" muted>{textos.sinAutomatizaciones}</Text>}
        {automatizaciones.length > 0 && <Text size="xs" muted>{textos.sinAperturaAutomatizacion}</Text>}
      </Bloque>

      <Bloque titulo={textos.flujos}>
        {flujos.length ? (
          <List label={textos.flujos}>
            {flujos.map((mensaje, indice) => (
              <Fila key={`${mensaje.hora}-${indice}`} tone={tonoFlujo(mensaje)}
                titulo={traducirAsunto(mensaje.asunto ?? textos.sinAsunto)}
                detalle={`${textos.recorrido(nombre(mensaje.origen), nombre(mensaje.destino))} · ${fechaCorta(mensaje.hora, ahora)}`} />
            ))}
          </List>
        ) : <Text size="xs" muted>{textos.sinFlujos}</Text>}
      </Bloque>

      <Select label={textos.minutosAtasco} value={String(minutos)}
        options={[10, 20, 30, 60].map((valor) => ({ value: String(valor), label: textos.minutos(valor) }))}
        onChange={(valor) => set(minutosAtasco, Number(valor))} />
    </Stack>
  )
}

export default function Panel() {
  const actual = read(grafo)
  return (
    <Stack gap="sm">
      <Row justify="between" align="center">
        <Heading level={3}>{textos.colmena}</Heading>
        <IconButton icon="open-external" label={textos.abrirPestana} size="sm" variant="ghost"
          disabled={read(abriendo)} onPress={abrir} />
      </Row>
      <Text size="sm">{actual ? resumen(actual) : read(fallo) ? textos.falloPanel : textos.consultando}</Text>
      {read(errorApertura) && <Text tone="danger" size="xs">{read(errorApertura)}</Text>}
      {actual && <Torre actual={actual} />}
      {!!actual?.fallos.length && <Text size="xs" muted>{textos.errores(actual.fallos.length)}</Text>}
    </Stack>
  )
}
