import type { CitaParaRecordatorio, ConsultorioParaMensaje } from '@consultorio/contracts';
import type { Almacen } from '@consultorio/platform';

/** Llamadas internas a svc-agenda (`/interno/citas-para-recordatorio`); fechas locales `YYYY-MM-DD`. */
export interface ClienteAgenda {
  obtenerCitas(tenantId: string, desde: string, hasta: string): Promise<CitaParaRecordatorio[]>;
}

/** Llamadas internas a svc-identidad (`/interno/consultorio-para-mensaje`). */
export interface ClienteIdentidad {
  obtenerConsultorio(tenantId: string): Promise<ConsultorioParaMensaje>;
}

export interface MensajeCorreo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
  /** Logo en línea (CID), si el consultorio tiene. */
  logo?: { bytes: Uint8Array; tipo: string; cid: string };
}

/** Canal de correo (SMTP en producción, Mailpit en local). Lanza si no se pudo enviar. */
export interface CanalCorreo {
  enviar(mensaje: MensajeCorreo): Promise<void>;
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
