import { defineCheck } from 'orca/testing'
import { normalizar } from './normalizar'

export default defineCheck({
  recuento: { requests: { 'grafo.obtener': normalizar({}, 1) } },
})
