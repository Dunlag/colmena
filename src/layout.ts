import { LOCAL } from './datos'
import type { Grafo, Nodo } from './normalizar'
import { textos } from './textos'

const MARGEN = 12
const PADDING = 14
const ALTO_TARJETA = 88
const ESPACIO_FILAS = 12
const PASO = ALTO_TARJETA + ESPACIO_FILAS
const CABECERA = 48
const CALLE = 42
const ANCHO_MIN = 166
const ANCHO_MAX = 326

export type Posicion = {
  nodo: Nodo
  x: number
  y: number
  ancho: number
  alto: number
}

type Banda = {
  id: string
  nombre: string
  estado?: string
  y: number
  ancho: number
  alto: number
  automatizacionesY?: number
}

export function disponer(grafo: Pick<Grafo, 'nodos' | 'aristas'>, disponible = 850) {
  const nodos = new Map(grafo.nodos.filter(({ tipo }) => tipo !== 'maquina').map((nodo) => [nodo.id, nodo]))
  const maquinas = new Map(grafo.nodos.filter(({ tipo }) => tipo === 'maquina').map((nodo) => [nodo.maquina, nodo]))
  const raiz = [...nodos.values()].find(({ tipo }) => tipo === 'tu')
  const bobs = new Map([...nodos.values()]
    .filter(({ tipo }) => tipo === 'bob')
    .map((nodo) => [nodo.maquina, nodo.id]))
  const candidatos = new Map<string, string[]>()
  for (const arista of grafo.aristas) {
    if (arista.tipo === 'mensaje' || !nodos.has(arista.origen) || !nodos.has(arista.destino)) continue
    const opciones = candidatos.get(arista.destino) ?? []
    if (arista.tipo === 'lanzamiento') opciones.unshift(arista.origen)
    else opciones.push(arista.origen)
    candidatos.set(arista.destino, opciones)
  }

  const padres = new Map<string, string>()
  function valido(hijo: string, candidato?: string): candidato is string {
    for (let padre = candidato; padre; padre = padres.get(padre)) {
      if (padre === hijo) return false
    }
    return candidato !== undefined
  }
  for (const nodo of nodos.values()) {
    if (nodo.id === raiz?.id) continue
    const bob = bobs.get(nodo.maquina)
    const respaldo = bob === nodo.id ? raiz?.id : bob ?? bobs.get(LOCAL) ?? raiz?.id
    const enlaces = candidatos.get(nodo.id) ?? []
    const opciones = (nodo.tipo === 'bot' || nodo.tipo === 'bob') ? [respaldo, ...enlaces] : [...enlaces, respaldo]
    const padre = [...opciones, raiz?.id].find((opcion) => valido(nodo.id, opcion))
    if (padre) padres.set(nodo.id, padre)
  }

  function botDe(nodo: Nodo) {
    for (let padre = padres.get(nodo.id); padre; padre = padres.get(padre)) {
      const tipo = nodos.get(padre)?.tipo
      if (tipo === 'bot' || tipo === 'bob') return padre
    }
    return undefined
  }

  const hosts = new Set([...maquinas.keys(), ...[...nodos.values()].map((nodo) => nodo.maquina)])
  const orden = [...hosts].sort((a, b) => {
    if (a === LOCAL) return -1
    if (b === LOCAL) return 1
    return (maquinas.get(a)?.nombre ?? a).localeCompare(maquinas.get(b)?.nombre ?? b, textos.idioma)
  })
  const anchoTarjeta = Math.round(Math.min(ANCHO_MAX, Math.max(
    ANCHO_MIN, (disponible - 2 * (MARGEN + PADDING + CALLE)) / 3,
  )))
  const ancho = 2 * (MARGEN + PADDING + CALLE) + 3 * anchoTarjeta
  const bandas: Banda[] = []
  const posiciones = new Map<string, Posicion>()
  let y = MARGEN

  for (const id of orden) {
    const miembros = [...nodos.values()].filter((nodo) => nodo.maquina === id)
    const izquierda = miembros.filter((nodo) => nodo.tipo === 'tu' || nodo.id === bobs.get(id))
    const centro = miembros.filter((nodo) => nodo.tipo === 'bot' && nodo.id !== bobs.get(id))
    const derecha = miembros.filter((nodo) => nodo.tipo === 'worker' ||
      (nodo.tipo === 'automatizacion' && centro.some((bot) => botDe(nodo) === bot.id)))
    const aparte = miembros.filter((nodo) => nodo.tipo === 'automatizacion' && !derecha.includes(nodo))
    const banda: Banda = { id, nombre: maquinas.get(id)?.nombre ?? id, estado: maquinas.get(id)?.estado,
      y, ancho: ancho - 2 * MARGEN, alto: 0 }
    const arriba = y + CABECERA
    function colocar(nodo: Nodo, columna: number, fila: number) {
      posiciones.set(nodo.id, {
        nodo, x: MARGEN + PADDING + columna * (anchoTarjeta + CALLE),
        y: arriba + fila, ancho: anchoTarjeta, alto: ALTO_TARJETA,
      })
    }
    let usados = 0
    const colocados = new Set<string>()
    for (const bot of centro) {
      const familia = derecha.filter((nodo) => botDe(nodo) === bot.id)
      colocar(bot, 1, usados + Math.max(0, familia.length - 1) * PASO / 2)
      for (const [i, nodo] of familia.entries()) {
        colocar(nodo, 2, usados + i * PASO)
        colocados.add(nodo.id)
      }
      usados += Math.max(1, familia.length) * PASO
    }
    for (const nodo of derecha) {
      if (colocados.has(nodo.id)) continue
      colocar(nodo, 2, usados)
      usados += PASO
    }
    const filasIzquierda = izquierda.length * PASO
    const altura = Math.max(filasIzquierda, usados, PASO)
    izquierda.forEach((nodo, i) => colocar(nodo, 0, i * PASO))
    for (const nodo of aparte) padres.delete(nodo.id)
    if (aparte.length) banda.automatizacionesY = arriba + altura + 2
    aparte.forEach((nodo, i) => colocar(nodo, i % 3, altura + 28 + Math.floor(i / 3) * PASO))
    banda.alto = CABECERA + altura - ESPACIO_FILAS + PADDING +
      (aparte.length ? 28 + Math.ceil(aparte.length / 3) * PASO : 0)
    bandas.push(banda)
    y += banda.alto + MARGEN
  }

  return { bandas, posiciones, padres, ancho, alto: y }
}

export function curva(origen: Posicion, destino: Posicion, desvio = 0): string {
  const y1 = origen.y + origen.alto / 2 + desvio
  const y2 = destino.y + destino.alto / 2 + desvio
  if (origen.x === destino.x) {
    const lado = origen.x + origen.ancho
    const carril = lado + 20 + desvio
    return `M ${lado} ${y1} C ${carril} ${y1}, ${carril} ${y2}, ${lado} ${y2}`
  }
  const directa = origen.x < destino.x
  const x1 = directa ? origen.x + origen.ancho : origen.x
  const x2 = directa ? destino.x : destino.x + destino.ancho
  const centro = (x1 + x2) / 2 + desvio
  return `M ${x1} ${y1} C ${centro} ${y1}, ${centro} ${y2}, ${x2} ${y2}`
}
