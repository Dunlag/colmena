import { defineCheck } from 'orca/testing'
import { grafoEjemplo } from './ejemplo'

export default defineCheck({
  recuento: { requests: { 'grafo.obtener': grafoEjemplo() } },
})
