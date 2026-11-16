import type { CitaParaRecordatorio, ConsultorioParaMensaje } from '@consultorio/contracts';
import type { Almacen } from '@consultorio/platform';
import type { CanalCorreo } from './correo/canal.js';

export type { AdjuntoEnLinea, CanalCorreo, MensajeCorreo } from './correo/canal.js';

/** Llamadas internas a svc-agenda (`/interno/citas-para-recordatorio`); fechas locales `YYYY-MM-DD`. */
export interface ClienteAgenda {
  obtenerCitas(tenantId: string, desde: string, hasta: string): Promise<CitaParaRecordatorio[]>;
}

/** Llamadas internas a svc-identidad (`/interno/consultorio-para-mensaje`). */
export interface ClienteIdentidad {
  obtenerConsultorio(tenantId: string): Promise<ConsultorioParaMensaje>;
}

/** Solo lectura sobre `logos/*`. */
export type AlmacenLectura = Pick<Almacen, 'leer'>;

/** Dependencias externas del servicio; en pruebas se inyectan dobles. */
export interface Puertos {
  agenda: ClienteAgenda;
  identidad: ClienteIdentidad;
  correo: CanalCorreo;
  almacen: AlmacenLectura;
}
