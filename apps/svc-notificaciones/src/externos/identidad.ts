import { consultorioParaMensajeSchema } from '@consultorio/contracts';
import { llamarInterno } from '@consultorio/platform';
import type { ClienteIdentidad } from '../puertos.js';

/** Cliente de `GET /interno/consultorio-para-mensaje` (3 s de límite por llamada). */
export function crearClienteIdentidad(base: string, tokenInterno: string): ClienteIdentidad {
  return {
    obtenerConsultorio: (tenantId) => {
      const consulta = new URLSearchParams({ tenantId });
      return llamarInterno(base, `/interno/consultorio-para-mensaje?${consulta}`, tokenInterno, consultorioParaMensajeSchema, 3000);
    },
  };
}
