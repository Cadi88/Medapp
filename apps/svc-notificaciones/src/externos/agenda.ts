import { citasParaRecordatorioRespuestaSchema } from '@consultorio/contracts';
import { llamarInterno } from '@consultorio/platform';
import type { ClienteAgenda } from '../puertos.js';

/** Cliente de `GET /interno/citas-para-recordatorio` (3 s de límite por llamada). */
export function crearClienteAgenda(base: string, tokenInterno: string): ClienteAgenda {
  return {
    obtenerCitas: async (tenantId, desde, hasta) => {
      const consulta = new URLSearchParams({ tenantId, desde, hasta });
      const r = await llamarInterno(base, `/interno/citas-para-recordatorio?${consulta}`, tokenInterno, citasParaRecordatorioRespuestaSchema, 3000);
      return r.citas;
    },
  };
}
