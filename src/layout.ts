import { LOCAL } from './datos'
import type { Grafo, Nodo } from './normalizar'
import { textos } from './textos'

const MARGEN = 12
const ANCHO_BANDA = 322
const ESPACIO_BANDAS = 18
const ALTURA_CABECERA = 66
const ALTO_TARJETA = 106
const ESPACIO_TARJETAS = 24
const SANGRIA = 12

export type Posicion = {
  nodo: Nodo
  x: number
  y: number
  ancho: number
  alto: number
  bandaX: number
}

type Banda = { id: string; nombre: string; estado?: string; x: number; ancho: number; alto: number }

export function disponer(grafo: Pick<Grafo, 'nodos' | 'aristas'>) {
  const nodos = new Map(grafo.nodos.filter(({ tipo }) => tipo !== 'maquina').map((nodo) => [nodo.id, nodo]))
  const maquinas = new Map(grafo.nodos.filter(({ tipo }) => tipo === 'maquina').map((nodo) => [nodo.maquina, nodo]))
  const raiz = [...nodos.values()].find(({ tipo }) => tipo === 'tu')
  const bobs = new Map([...nodos.values()]
    .filter(({ tipo, nombre }) => tipo === 'bot' && nombre === textos.bob)
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
    const opciones = nodo.tipo === 'bot' ? [respaldo, ...enlaces] : [...enlaces, respaldo]
    const padre = [...opciones, raiz?.id].find((opcion) => valido(nodo.id, opcion))
    if (padre) padres.set(nodo.id, padre)
  }

  const hijos = new Map<string | undefined, Nodo[]>()
  for (const nodo of nodos.values()) {
    const padre = padres.get(nodo.id)
    const grupo = hijos.get(padre) ?? []
    grupo.push(nodo)
    hijos.set(padre, grupo)
  }

  const hosts = new Set([...maquinas.keys(), ...[...nodos.values()].map((nodo) => nodo.maquina)])
  const bandas = [...hosts].sort((a, b) => {
    if (a === LOCAL) return -1
    if (b === LOCAL) return 1
    return (maquinas.get(a)?.nombre ?? a).localeCompare(maquinas.get(b)?.nombre ?? b, textos.idioma)
  }).map((id, indice): Banda => ({
    id, nombre: maquinas.get(id)?.nombre ?? id, estado: maquinas.get(id)?.estado,
    x: MARGEN + indice * (ANCHO_BANDA + ESPACIO_BANDAS), ancho: ANCHO_BANDA,
    alto: ALTURA_CABECERA + MARGEN,
  }))
  const porMaquina = new Map(bandas.map((banda) => [banda.id, banda]))
  const posiciones = new Map<string, Posicion>()
  const filas = new Map<string, number>()
  const porVisitar = (hijos.get(undefined) ?? []).map((nodo) => ({ nodo, nivel: 0 })).reverse()
  while (porVisitar.length) {
    const { nodo, nivel } = porVisitar.pop()!
    const banda = porMaquina.get(nodo.maquina)!
    const fila = filas.get(nodo.maquina) ?? 0
    const margenIzquierdo = 26 + Math.min(nivel, 3) * SANGRIA
    const y = MARGEN + ALTURA_CABECERA + fila * (ALTO_TARJETA + ESPACIO_TARJETAS)
    posiciones.set(nodo.id, {
      nodo, x: banda.x + margenIzquierdo, y, ancho: banda.ancho - margenIzquierdo - MARGEN,
      alto: ALTO_TARJETA, bandaX: banda.x,
    })
    filas.set(nodo.maquina, fila + 1)
    banda.alto = y + ALTO_TARJETA
    const rama = hijos.get(nodo.id) ?? []
    for (let i = rama.length - 1; i >= 0; i--) {
      porVisitar.push({ nodo: rama[i], nivel: rama[i].maquina === nodo.maquina ? nivel + 1 : 0 })
    }
  }

  return {
    bandas, posiciones, padres,
    ancho: bandas.length * (ANCHO_BANDA + ESPACIO_BANDAS) - (bandas.length ? ESPACIO_BANDAS : 0) + 2 * MARGEN,
    alto: Math.max(0, ...bandas.map((banda) => banda.alto)) + 2 * MARGEN,
  }
}

export function curva(origen: Posicion, destino: Posicion): string {
  const yOrigen = origen.y + origen.alto / 2
  const yDestino = destino.y + destino.alto / 2
  if (origen.bandaX === destino.bandaX) {
    const carril = Math.min(origen.x, destino.x) - 14
    const giro = Math.min(18, Math.abs(yDestino - yOrigen) / 2) * Math.sign(yDestino - yOrigen)
    return `M ${origen.x} ${yOrigen} Q ${carril} ${yOrigen} ${carril} ${yOrigen + giro}
      V ${yDestino - giro} Q ${carril} ${yDestino} ${destino.x} ${yDestino}`
  }
  const carril = destino.bandaX + MARGEN
  const salida = origen.x + origen.ancho / 2
  const base = origen.y + origen.alto
  const cruce = base + ESPACIO_TARJETAS / 2
  const direccion = Math.sign(carril - salida)
  const giro = 10 * Math.sign(yDestino - cruce)
  return `M ${salida} ${base} Q ${salida} ${cruce} ${salida + 10 * direccion} ${cruce}
    H ${carril - 10 * direccion} Q ${carril} ${cruce} ${carril} ${cruce + giro}
    V ${yDestino - giro} Q ${carril} ${yDestino} ${destino.x} ${yDestino}`
}
