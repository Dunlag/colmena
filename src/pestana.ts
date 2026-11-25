import type { OrcaFrameApi } from 'orca/frame'
import { mensajes, ultimos30Segundos, VENTANA_FLUJO_MS, type Mensaje } from './flujos'
import { curva, disponer } from './layout'
import type { Grafo, Nodo } from './normalizar'
import { textos } from './textos'

const CANTIDAD_FLUJOS = 20
const NIVELES = { ahorro: textos.ahorro, completo: textos.completo } as const
type Nivel = keyof typeof NIVELES

const tipos: Record<Nodo['tipo'], string> = {
  tu: textos.usuario, bob: textos.bob, bot: textos.bot, worker: textos.worker,
  automatizacion: textos.automatizacion, maquina: textos.maquina,
}
const tonos = new Map<string, string>([
  [textos.enCurso, 'verde'], [textos.disponible, 'verde'], [textos.activa, 'verde'],
  [textos.espera, 'azul'], [textos.pendiente, 'ambar'], [textos.bloqueado, 'ambar'],
  [textos.fallido, 'rojo'], [textos.noDisponible, 'rojo'],
])

function elemento<K extends keyof HTMLElementTagNameMap>(
  tipo: K, clase = '', contenido = '',
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(tipo)
  if (clase) nodo.className = clase
  if (contenido) nodo.textContent = contenido
  return nodo
}

function svg<K extends keyof SVGElementTagNameMap>(tipo: K, atributos: Record<string, string | number>) {
  const nodo = document.createElementNS('http://www.w3.org/2000/svg', tipo)
  for (const [clave, valor] of Object.entries(atributos)) nodo.setAttribute(clave, String(valor))
  return nodo
}

const horario = new Intl.DateTimeFormat(textos.idioma, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const relativo = new Intl.RelativeTimeFormat(textos.idioma, { style: 'short' })

function hace(hora: number, ahora: number): string {
  const segundos = Math.max(0, Math.floor((ahora - hora) / 1000))
  if (segundos < 60) return relativo.format(-segundos, 'second')
  if (segundos < 3600) return relativo.format(-Math.floor(segundos / 60), 'minute')
  if (segundos < 86400) return relativo.format(-Math.floor(segundos / 3600), 'hour')
  return relativo.format(-Math.floor(segundos / 86400), 'day')
}

function tono(nodo: Nodo) {
  if (nodo.tipo === 'tu' && nodo.pendientes?.length) return 'ambar'
  return tonos.get(nodo.estado) ?? 'neutro'
}

export function montarPestana(orca: OrcaFrameApi) {
  const movimiento = matchMedia('(prefers-reduced-motion: reduce)')
  const vida = new AbortController()
  const opciones = { signal: vida.signal }
  const niveles = new Map<string, Nivel>()
  const cargando = new Set<string>()
  const guardando = new Set<string>()
  let grafo: Grafo | undefined
  let firma = ''
  let necesitaDibujo = false
  let aviso = ''
  let visibleEnOrca = false
  let frame = 0
  let reloj = 0
  let animables: { circulo: SVGCircleElement; camino: SVGPathElement; longitud: number; mensaje: Mensaje; fase: number }[] = []
  let pulsos: HTMLElement[] = []
  let fechas: { hora: number; control: HTMLTimeElement }[] = []

  const app = elemento('main', 'colmena')
  const cabecera = elemento('header', 'cabecera')
  const titulo = elemento('h1', '', textos.colmena)
  const resumen = elemento('p', 'secundario')
  const avisoUI = elemento('p', 'aviso')
  avisoUI.setAttribute('role', 'status')
  avisoUI.hidden = true
  cabecera.append(titulo, resumen, avisoUI)
  const contenido = elemento('div', 'contenido')
  const panelArbol = elemento('section', 'arbol')
  panelArbol.setAttribute('aria-label', textos.arbol)
  const superficie = elemento('div', 'superficie')
  panelArbol.append(superficie)
  const panelFlujos = elemento('aside', 'flujos')
  const tituloFlujos = elemento('h2', '', textos.flujos)
  const listaFlujos = elemento('ol', 'lista-flujos')
  const vacio = elemento('p', 'secundario vacio', textos.sinFlujos)
  panelFlujos.append(tituloFlujos, listaFlujos, vacio)
  contenido.append(panelArbol, panelFlujos)
  app.append(cabecera, contenido)

  function visible() {
    return visibleEnOrca && document.visibilityState === 'visible'
  }

  function informar(error = '') {
    aviso = error
    if (visible()) {
      avisoUI.textContent = aviso
      avisoUI.hidden = !aviso
    }
  }

  function completo(id: string) {
    return !movimiento.matches && niveles.get(id) === 'completo'
  }

  const claveNivel = (id: string) => `animacion:${id}`

  function cargarNivel(id: string) {
    if (niveles.has(id) || cargando.has(id)) return
    cargando.add(id)
    void orca.storage.get(claveNivel(id)).then((valor) => {
      niveles.set(id, valor === 'completo' ? 'completo' : 'ahorro')
    }, () => niveles.set(id, 'ahorro')).finally(() => {
      cargando.delete(id)
      invalidar()
    })
  }

  async function guardarNivel(id: string, nivel: Nivel) {
    if (guardando.has(id)) return
    guardando.add(id)
    const anterior = niveles.get(id)
    niveles.set(id, nivel)
    informar()
    invalidar()
    try {
      await orca.storage.set(claveNivel(id), nivel)
    } catch {
      niveles.set(id, anterior ?? 'ahorro')
      informar(textos.falloAnimacion)
    } finally {
      guardando.delete(id)
      invalidar()
    }
  }

  function selectorNivel(id: string, nombre: string) {
    const etiqueta = elemento('label', 'ajuste', textos.animacion)
    const control = elemento('select')
    control.dataset.foco = `nivel:${id}`
    control.setAttribute('aria-label', textos.animacionMaquina(nombre))
    for (const [nivel, rotulo] of Object.entries(NIVELES)) {
      const opcion = elemento('option', '', rotulo)
      opcion.value = nivel
      control.append(opcion)
    }
    control.value = completo(id) ? 'completo' : 'ahorro'
    control.disabled = !niveles.has(id) || movimiento.matches
    if (movimiento.matches) etiqueta.title = textos.movimientoReducido
    control.addEventListener('change', () => void guardarNivel(id, control.value as Nivel))
    etiqueta.append(control)
    return etiqueta
  }

  function tarjeta(nodo: Nodo, maquina: string) {
    const control = elemento('button', 'nodo')
    control.type = 'button'
    control.dataset.foco = `nodo:${nodo.id}`
    control.dataset.tono = tono(nodo)
    control.dataset.tipo = nodo.tipo
    control.setAttribute('aria-label', textos.etiquetaNodo(nodo.nombre, nodo.estado))
    if (nodo.atenuado) control.classList.add('atenuado')
    if (!nodo.destino || (nodo.maquina.startsWith('runtime:') && !nodo.destino.terminalId)) {
      control.setAttribute('aria-disabled', 'true')
      control.title = textos.sinDestino
    } else {
      control.addEventListener('click', async () => {
        informar()
        try {
          const { error } = await orca.plugin.request('nodo.abrir', { id: nodo.id }, opciones)
          if (error) informar(error)
        } catch {
          if (!vida.signal.aborted) informar(textos.falloAbrirNodo)
        }
      })
    }
    const nombre = elemento('span', 'nombre truncado', nodo.nombre)
    nombre.title = nodo.nombre
    const detalle = `${nodo.modelo ?? nodo.agente ?? tipos[nodo.tipo]} · ${maquina}`
    const meta = elemento('span', 'secundario truncado', detalle)
    meta.title = detalle
    const tarea = elemento('span', 'tarea truncado', nodo.tarea ?? textos.sinTarea)
    if (nodo.tarea) tarea.title = nodo.tarea
    const pie = elemento('span', 'pie')
    const estado = elemento('span', 'estado truncado', nodo.estado)
    const punto = elemento('span', 'punto')
    estado.prepend(punto)
    estado.title = nodo.estado
    if (completo(nodo.maquina) && !nodo.atenuado && tono(nodo) !== 'neutro') pulsos.push(punto)
    const fecha = elemento('time', 'secundario', textos.sinFecha)
    if (nodo.desde !== null) {
      fecha.dateTime = new Date(nodo.desde).toISOString()
      fecha.title = horario.format(nodo.desde)
      fechas.push({ hora: nodo.desde, control: fecha })
    }
    pie.append(estado, fecha)
    control.append(nombre, meta, tarea, pie)
    return control
  }

  function refrescarHoras() {
    const ahora = Date.now()
    for (const { hora, control } of fechas) {
      const texto = hace(hora, ahora)
      if (control.textContent !== texto) control.textContent = texto
    }
  }

  function dibujar() {
    if (!visible() || !necesitaDibujo) return
    necesitaDibujo = false
    if (!app.isConnected) document.body.append(app)
    informar(aviso)
    if (!grafo) {
      resumen.textContent = aviso ? '' : textos.consultando
      return
    }
    const activo = (document.activeElement as HTMLElement | null)?.dataset.foco
    animables = []
    pulsos = []
    fechas = []
    const { bandas, posiciones, padres, ancho, alto } = disponer(grafo)
    const elementos = document.createDocumentFragment()
    const nombres = new Map(bandas.map((banda) => [banda.id, banda.nombre]))
    superficie.style.width = `${ancho}px`
    superficie.style.height = `${alto}px`
    const leyenda = textos.recuento(posiciones.size, padres.size)
    resumen.textContent = grafo.fallos.length ? `${leyenda} · ${textos.errores(grafo.fallos.length)}` : leyenda

    for (const banda of bandas) {
      cargarNivel(banda.id)
      const fondo = elemento('div', 'banda')
      fondo.style.left = `${banda.x}px`
      fondo.style.width = `${banda.ancho}px`
      fondo.style.height = `${banda.alto}px`
      const titulo = elemento('h2', 'truncado', banda.nombre)
      titulo.title = banda.estado ? textos.etiquetaNodo(banda.nombre, banda.estado) : banda.nombre
      fondo.append(titulo, selectorNivel(banda.id, banda.nombre))
      elementos.append(fondo)
    }

    const curvas = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, 'aria-hidden': 'true', class: 'curvas' })
    const enlaces = new Map<string, SVGPathElement>()
    const clave = (origen: string, destino: string) => JSON.stringify([origen, destino])
    const hacerCamino = (origen: string, destino: string, clase: string) => {
      const desde = posiciones.get(origen)!
      const hasta = posiciones.get(destino)!
      const camino = svg('path', { d: curva(desde, hasta), class: clase, 'data-tono': tono(hasta.nodo) })
      enlaces.set(clave(origen, destino), camino)
      curvas.append(camino)
      return camino
    }
    for (const [hijo, padre] of padres) hacerCamino(padre, hijo, 'conexion')
    elementos.append(curvas)
    for (const { nodo, x, y, ancho, alto } of posiciones.values()) {
      const control = tarjeta(nodo, nombres.get(nodo.maquina) ?? nodo.maquina)
      Object.assign(control.style, { left: `${x}px`, top: `${y}px`, width: `${ancho}px`, height: `${alto}px` })
      elementos.append(control)
    }

    const entradas = mensajes(grafo.aristas)
    const lista = document.createDocumentFragment()
    for (const { origen, destino, hora, asunto } of entradas.slice(0, CANTIDAD_FLUJOS)) {
      const ruta = textos.recorrido(posiciones.get(origen)?.nodo.nombre ?? origen, posiciones.get(destino)?.nodo.nombre ?? destino)
      const item = elemento('li', 'flujo')
      const nombre = elemento('span', 'ruta', ruta)
      const tiempo = elemento('time', 'secundario', horario.format(hora))
      tiempo.dateTime = new Date(hora).toISOString()
      item.append(nombre, elemento('span', 'asunto', asunto ?? textos.sinAsunto), tiempo)
      lista.append(item)
    }
    listaFlujos.replaceChildren(lista)
    vacio.hidden = entradas.length > 0

    const puntos = svg('g', {})
    const viajes = ultimos30Segundos(entradas, Date.now()).flatMap((mensaje, indice) => {
      const { origen, destino } = mensaje
      const desde = posiciones.get(origen)
      const hasta = posiciones.get(destino)
      if (!desde || !hasta || !completo(desde.nodo.maquina) || !completo(hasta.nodo.maquina)) return []
      const camino = enlaces.get(clave(origen, destino)) ?? hacerCamino(origen, destino, 'trayecto')
      const circulo = svg('circle', { r: 4, class: 'viaje' })
      puntos.append(circulo)
      return [{ circulo, camino, mensaje, fase: indice * 197 }]
    })
    curvas.append(puntos)
    superficie.replaceChildren(elementos)
    animables = viajes.map((viaje) => ({ ...viaje, longitud: viaje.camino.getTotalLength() }))
    if (activo) {
      for (const control of superficie.querySelectorAll<HTMLElement>('[data-foco]')) {
        if (control.dataset.foco === activo) control.focus({ preventScroll: true })
      }
    }
    refrescarHoras()
  }

  function invalidar() {
    necesitaDibujo = true
    if (visible()) {
      dibujar()
      pedirFrame()
    }
  }

  function pedirFrame() {
    if (visible() && !frame && (animables.length || pulsos.length)) frame = requestAnimationFrame(animar)
  }

  function animar(t: number) {
    frame = 0
    if (!visible()) return
    const ahora = Date.now()
    let caduco = false
    for (const viaje of animables) {
      const edad = ahora - viaje.mensaje.hora
      if (edad >= VENTANA_FLUJO_MS) {
        caduco = true
        break
      }
      const avance = ((Math.max(0, edad) + viaje.fase) % 4400) / 4400
      const punto = viaje.camino.getPointAtLength(avance * viaje.longitud)
      viaje.circulo.setAttribute('cx', String(punto.x))
      viaje.circulo.setAttribute('cy', String(punto.y))
    }
    if (caduco) {
      invalidar()
      return
    }
    const opacidad = 0.78 + 0.22 * Math.sin(t / 440)
    for (const punto of pulsos) punto.style.opacity = String(opacidad)
    pedirFrame()
  }

  function cambiarVisibilidad() {
    cancelAnimationFrame(frame)
    clearInterval(reloj)
    frame = 0
    if (!visible()) return
    invalidar()
    reloj = window.setInterval(() => {
      if (visible()) refrescarHoras()
    }, 1000)
  }

  function recibir(nuevo: Grafo) {
    if (vida.signal.aborted || (grafo && nuevo.generado < grafo.generado)) return
    grafo = nuevo
    const nuevaFirma = JSON.stringify([nuevo.nodos, nuevo.aristas, nuevo.fallos])
    if (firma === nuevaFirma) return
    firma = nuevaFirma
    invalidar()
  }

  const observador = new IntersectionObserver(([entrada]) => {
    const siguiente = entrada.isIntersecting
    if (visibleEnOrca === siguiente) return
    visibleEnOrca = siguiente
    cambiarVisibilidad()
  })
  observador.observe(document.documentElement)
  document.addEventListener('visibilitychange', cambiarVisibilidad, opciones)
  movimiento.addEventListener('change', invalidar, opciones)
  const cambios = orca.plugin.on('grafo.actualizado', recibir)
  // El archivo abre la vista. Los datos provienen del worker.
  void orca.document?.get().catch(() => {})
  void orca.plugin.request('grafo.obtener', undefined, opciones).then(recibir, () => {
    if (!vida.signal.aborted && !grafo) {
      informar(textos.falloPanel)
      invalidar()
    }
  })
  window.addEventListener('pagehide', () => {
    vida.abort()
    cambios.dispose()
    observador.disconnect()
    cancelAnimationFrame(frame)
    clearInterval(reloj)
  }, { once: true })
}

montarPestana(window.orca)
