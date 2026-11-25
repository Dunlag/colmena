import type { OrcaFrameApi } from 'orca/frame'
import { mensajes, tipoMensaje, ultimos30Segundos, VENTANA_FLUJO_MS } from './flujos'
import { curva, disponer } from './layout'
import type { Grafo, Nodo, Situacion } from './normalizar'
import { LATIDO_VISTA_MS } from './protocol'
import { textos, traducirAsunto } from './textos'

const CANTIDAD_FLUJOS = 20
const NIVELES = { ahorro: textos.ahorro, completo: textos.completo } as const
type Nivel = keyof typeof NIVELES

const tipos = {
  tu: { etiqueta: textos.usuario, icono: 'M9 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 15v-1a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1' },
  bob: { etiqueta: textos.coordinador, icono: 'M3 5l3 3 3-5 3 5 3-3-1.5 7h-9ZM5 15h8' },
  bot: { etiqueta: textos.bot, icono: 'M9 3v3M6 11h.1m5.8 0h.1M4 6h10a1 1 0 0 1 1 1v7H3V7a1 1 0 0 1 1-1ZM1.5 10v2m15-2v2' },
  worker: { etiqueta: textos.worker, icono: 'M3 4h12v10H3ZM6 7l2 2-2 2m4 0h2' },
  automatizacion: { etiqueta: textos.automatizacion, icono: 'M15 9a6 6 0 1 0-6 6h2m-2-9v3l2 1m1 4 2-2 2 2' },
  maquina: { etiqueta: textos.maquina, icono: 'M3 4h12v8H3Zm4 11h4m-2-3v3' },
}

const estados: Record<Situacion, { etiqueta: string; tono: string }> = {
  trabajando: { etiqueta: textos.trabajando, tono: 'verde' },
  esperando: { etiqueta: textos.esperando, tono: 'azul' },
  terminado: { etiqueta: textos.terminado, tono: 'neutro' },
}

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
  if (nodo.estado === textos.fallido) return 'rojo'
  if (nodo.estado === textos.bloqueado) return 'ambar'
  return estados[nodo.situacion].tono
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
  let frameTamano = 0
  let anchoArbol = 0
  let reloj = 0
  let latido = 0
  let puntosRecientes: { control: HTMLElement; vence: number }[] = []
  let fechas: { hora: number; control: HTMLTimeElement }[] = []

  const app = elemento('main', 'colmena')
  const cabecera = elemento('header', 'cabecera')
  const titulo = elemento('h1', '', textos.colmena)
  const resumen = elemento('p', 'secundario')
  const encabezado = elemento('div', 'encabezado')
  encabezado.append(titulo, resumen)
  const miembros = elemento('section', 'miembros')
  miembros.append(elemento('h2', 'rotulo', textos.miembros))
  const listaMiembros = elemento('ul', 'lista-miembros')
  miembros.append(listaMiembros)
  miembros.hidden = true
  const avisoUI = elemento('p', 'aviso')
  avisoUI.setAttribute('role', 'status')
  avisoUI.hidden = true
  const leyendaArbol = elemento('ul', 'leyenda-arbol')
  leyendaArbol.setAttribute('aria-label', textos.leyendaArbol)
  for (const [estilo, etiqueta] of [
    ['activa', textos.lineaActiva], ['reposo', textos.lineaEnReposo], ['mensaje', textos.puntoMensaje],
  ]) {
    const item = elemento('li', '', etiqueta)
    item.dataset.estilo = estilo
    leyendaArbol.append(item)
  }
  cabecera.append(encabezado, miembros, avisoUI, leyendaArbol)
  const contenido = elemento('div', 'contenido')
  const panelArbol = elemento('section', 'arbol')
  panelArbol.setAttribute('aria-label', textos.arbol)
  const superficie = elemento('div', 'superficie')
  panelArbol.append(superficie)
  const panelFlujos = elemento('aside', 'flujos')
  const tituloFlujos = elemento('h2', '', textos.flujos)
  const cabeceraFlujos = elemento('div', 'cabecera-flujos')
  const leyendaFlujos = elemento('ul', 'leyenda-flujos')
  for (const [tipo, etiqueta] of Object.entries(textos.tiposMensaje)) {
    const item = elemento('li', 'tipo-flujo', etiqueta)
    item.dataset.mensaje = tipo
    leyendaFlujos.append(item)
  }
  cabeceraFlujos.append(tituloFlujos, leyendaFlujos)
  const listaFlujos = elemento('ol', 'lista-flujos')
  const vacio = elemento('p', 'secundario vacio', textos.sinFlujos)
  panelFlujos.append(cabeceraFlujos, listaFlujos, vacio)
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

  function iconoNodo(nodo: Nodo) {
    const icono = elemento('span', 'icono-nodo')
    icono.setAttribute('aria-hidden', 'true')
    const dibujo = svg('svg', { viewBox: '0 0 18 18', width: 17, height: 17, focusable: 'false' })
    dibujo.append(svg('path', { d: tipos[nodo.tipo].icono }))
    icono.append(dibujo)
    return icono
  }

  function pintarMiembros(grafo: Grafo) {
    const elementos = grafo.nodos.filter((nodo) => nodo.tipo === 'bob' || nodo.tipo === 'bot' || (
      nodo.tipo === 'worker' && !nodo.atenuado
    ))
    miembros.hidden = elementos.length === 0
    listaMiembros.replaceChildren(...elementos.map((nodo) => {
      const item = elemento('li', 'miembro')
      item.dataset.tipo = nodo.tipo
      item.dataset.tono = tono(nodo)
      item.title = `${nodo.nombre} · ${estados[nodo.situacion].etiqueta}`
      const nombre = elemento('span', 'truncado', nodo.nombre)
      const estado = elemento('span', 'punto')
      estado.dataset.situacion = nodo.situacion
      estado.setAttribute('aria-label', estados[nodo.situacion].etiqueta)
      estado.setAttribute('role', 'img')
      item.append(iconoNodo(nodo), nombre, estado)
      return item
    }))
  }

  function tarjeta(nodo: Nodo, maquina: string) {
    const control = elemento('button', 'nodo')
    control.type = 'button'
    control.dataset.foco = `nodo:${nodo.id}`
    control.dataset.tono = tono(nodo)
    const tipo = nodo.tipo
    const situacion = estados[nodo.situacion].etiqueta
    control.dataset.tipo = tipo
    control.dataset.situacion = nodo.situacion
    if (tipo === 'worker' && nodo.situacion === 'trabajando' && completo(nodo.maquina)) {
      control.classList.add('pulso')
    }
    control.setAttribute('aria-label', textos.etiquetaNodo(nodo.nombre, situacion))
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
    const detalle = [tipos[tipo].etiqueta, nodo.agente, nodo.modelo].filter(Boolean).join(' · ')
    const meta = elemento('span', 'secundario truncado', detalle)
    meta.title = detalle
    const descripcion = nodo.tarea && nodo.tarea !== nodo.nombre ? nodo.tarea : ''
    const tarea = elemento('span', 'tarea truncado', descripcion)
    if (descripcion) tarea.title = descripcion
    const chip = elemento('span', 'chip-maquina truncado', maquina)
    chip.title = maquina
    const pie = elemento('span', 'pie')
    const estado = elemento('span', 'estado truncado', situacion)
    const punto = elemento('span', 'punto')
    punto.dataset.situacion = nodo.situacion
    punto.setAttribute('aria-hidden', 'true')
    estado.prepend(punto)
    estado.title = nodo.estado
    const fecha = elemento('time', 'secundario')
    if (nodo.desde !== null) {
      fecha.dateTime = new Date(nodo.desde).toISOString()
      fecha.title = horario.format(nodo.desde)
      fechas.push({ hora: nodo.desde, control: fecha })
    }
    pie.append(estado, chip)
    if (nodo.desde !== null) pie.append(fecha)
    const datos = elemento('span', 'datos-nodo')
    datos.append(nombre, meta)
    control.append(iconoNodo(nodo), datos, tarea, pie)
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
    puntosRecientes = []
    fechas = []
    anchoArbol = panelArbol.clientWidth
    const { bandas, posiciones, padres, ancho, alto } = disponer(grafo, anchoArbol)
    pintarMiembros(grafo)
    const elementos = document.createDocumentFragment()
    const nombres = new Map(bandas.map((banda) => [banda.id, banda.nombre]))
    superficie.style.width = `${ancho}px`
    superficie.style.height = `${alto}px`
    const leyenda = textos.recuento(grafo.recuento.nodos, grafo.recuento.conexiones)
    resumen.textContent = grafo.fallos.length ? `${leyenda} · ${textos.errores(grafo.fallos.length)}` : leyenda

    for (const banda of bandas) {
      cargarNivel(banda.id)
      const fondo = elemento('div', 'banda')
      fondo.style.top = `${banda.y}px`
      fondo.style.width = `${banda.ancho}px`
      fondo.style.height = `${banda.alto}px`
      const titulo = elemento('h2', 'truncado', banda.nombre)
      titulo.title = banda.estado ? textos.etiquetaNodo(banda.nombre, banda.estado) : banda.nombre
      const cabecera = elemento('div', 'cabecera-banda')
      cabecera.append(titulo, selectorNivel(banda.id, banda.nombre))
      fondo.append(cabecera)
      elementos.append(fondo)
      if (banda.automatizacionesY !== undefined) {
        const etiqueta = elemento('h3', 'rotulo grupo-automatizaciones', textos.automatizaciones)
        etiqueta.style.top = `${banda.automatizacionesY}px`
        elementos.append(etiqueta)
      }
    }

    const curvas = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, 'aria-hidden': 'true', class: 'curvas' })
    const enReposo = svg('g', {})
    const enCurso = svg('g', {})
    curvas.append(enReposo, enCurso)
    for (const [hijo, padre] of padres) {
      const desde = posiciones.get(padre)!
      const hasta = posiciones.get(hijo)!
      const d = curva(desde, hasta)
      const activo = hasta.nodo.situacion === 'trabajando'
      const grupo = svg('g', { class: activo ? 'en-curso' : 'en-reposo' })
      const ruta = textos.recorrido(desde.nodo.nombre, hasta.nodo.nombre)
      const diana = svg('path', { d, class: 'conexion-diana' })
      const titulo = svg('title', {})
      titulo.textContent = textos.etiquetaNodo(ruta, estados[hasta.nodo.situacion].etiqueta)
      diana.append(titulo)
      grupo.append(svg('path', { d, class: 'conexion' }))
      if (activo && hasta.nodo.tipo === 'worker' && completo(hasta.nodo.maquina)) {
        grupo.append(svg('path', { d, class: 'avance', pathLength: 100 }))
      }
      grupo.append(diana)
      const capa = activo ? enCurso : enReposo
      capa.append(grupo)
    }
    elementos.append(curvas)
    const ordenBandas = new Map(bandas.map((banda, i) => [banda.id, i]))
    const tarjetas = [...posiciones.values()].sort((a, b) =>
      ordenBandas.get(a.nodo.maquina)! - ordenBandas.get(b.nodo.maquina)! || a.x - b.x || a.y - b.y)
    for (const { nodo, x, y, ancho, alto } of tarjetas) {
      const control = tarjeta(nodo, nombres.get(nodo.maquina) ?? nodo.maquina)
      Object.assign(control.style, { left: `${x}px`, top: `${y}px`, width: `${ancho}px`, height: `${alto}px` })
      elementos.append(control)
    }

    const entradas = mensajes(grafo.aristas)
    const lista = document.createDocumentFragment()
    for (const mensaje of entradas.slice(0, CANTIDAD_FLUJOS)) {
      const { origen, destino, hora, asunto } = mensaje
      const tipo = tipoMensaje(mensaje)
      const ruta = textos.recorrido(posiciones.get(origen)?.nodo.nombre ?? origen, posiciones.get(destino)?.nodo.nombre ?? destino)
      const item = elemento('li', 'flujo')
      item.dataset.mensaje = tipo
      const encabezado = elemento('div', 'encabezado-flujo')
      const nombre = elemento('span', 'ruta', ruta)
      const tiempo = elemento('time', 'secundario', horario.format(hora))
      tiempo.dateTime = new Date(hora).toISOString()
      encabezado.append(elemento('span', 'tipo-flujo', textos.tiposMensaje[tipo]), tiempo)
      item.append(encabezado, nombre, elemento('span', 'asunto', traducirAsunto(asunto ?? textos.sinAsunto)))
      lista.append(item)
    }
    listaFlujos.replaceChildren(lista)
    vacio.hidden = entradas.length > 0

    const recorridos = new Set<string>()
    const porPareja = new Map<string, number>()
    const ahora = Date.now()
    for (const mensaje of ultimos30Segundos(entradas, ahora).slice(0, CANTIDAD_FLUJOS)) {
      const { origen, destino, hora } = mensaje
      const desde = posiciones.get(origen)
      const hasta = posiciones.get(destino)
      if (!desde || !hasta) continue
      const tipo = tipoMensaje(mensaje)
      const id = JSON.stringify([origen, destino, tipo])
      if (recorridos.has(id)) continue
      recorridos.add(id)
      const pareja = JSON.stringify([origen, destino].sort())
      const carril = porPareja.get(pareja) ?? 0
      porPareja.set(pareja, carril + 1)
      const desvio = (carril % 2 === 0 ? 1 : -1) * (7 + Math.floor(carril / 2) * 6)
      const punto = elemento('span', 'viaje')
      punto.dataset.mensaje = tipo
      punto.setAttribute('aria-hidden', 'true')
      punto.style.offsetPath = `path("${curva(desde, hasta, desvio)}")`
      if (completo(desde.nodo.maquina) && completo(hasta.nodo.maquina)) {
        punto.classList.add('viaje-animado')
        punto.style.animationDelay = `-${(ahora - hora) % 4400}ms`
      }
      elementos.append(punto)
      puntosRecientes.push({ control: punto, vence: hora + VENTANA_FLUJO_MS })
    }
    superficie.replaceChildren(elementos)
    if (activo) {
      for (const control of superficie.querySelectorAll<HTMLElement>('[data-foco]')) {
        if (control.dataset.foco === activo) control.focus({ preventScroll: true })
      }
    }
    refrescarHoras()
  }

  function invalidar() {
    necesitaDibujo = true
    dibujar()
  }

  function expirarPuntos() {
    if (!puntosRecientes.length) return
    const ahora = Date.now()
    puntosRecientes = puntosRecientes.filter(({ control, vence }) => {
      if (ahora < vence) return true
      control.remove()
      return false
    })
  }

  function avisarVisible(visible: boolean) {
    void orca.plugin.request('vista.visible', { visible }).catch(() => {})
  }

  function cambiarVisibilidad() {
    clearInterval(reloj)
    clearInterval(latido)
    const enPantalla = visible()
    app.toggleAttribute('data-visible', enPantalla)
    avisarVisible(enPantalla)
    cancelAnimationFrame(frameTamano)
    frameTamano = 0
    if (!enPantalla) return
    invalidar()
    latido = window.setInterval(() => avisarVisible(visible()), LATIDO_VISTA_MS)
    reloj = window.setInterval(() => {
      if (!visible()) return
      refrescarHoras()
      expirarPuntos()
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
  const tamano = new ResizeObserver(() => {
    if (!visible() || frameTamano || panelArbol.clientWidth === anchoArbol) return
    frameTamano = requestAnimationFrame(() => {
      frameTamano = 0
      invalidar()
    })
  })
  tamano.observe(panelArbol)
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
    app.removeAttribute('data-visible')
    avisarVisible(false)
    vida.abort()
    clearInterval(latido)
    cambios.dispose()
    observador.disconnect()
    tamano.disconnect()
    cancelAnimationFrame(frameTamano)
    clearInterval(reloj)
  }, { once: true })
}

montarPestana(window.orca)
