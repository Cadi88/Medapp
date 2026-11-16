import type { CitaParaRecordatorio, ConsultorioParaMensaje, RecordatorioCita } from '@consultorio/contracts';
import type { DateTime } from 'luxon';
import { fechaCitaLocal, fechaYHoraLocal, sinAprobarYVencido } from './calendario.js';
import type { EstadoEnvio, ModoRecordatorios } from './calendario.js';
import { rellenar, type DatosPlantilla, type Plantillas } from './plantillas.js';
import { enlaceWhatsApp } from './whatsapp.js';

/** Lo que la pantalla necesita de un `envio` (sin ids ni datos de contacto). */
export interface EnvioDeCita {
  canal: 'correo' | 'whatsapp_asistido';
  estado: EstadoEnvio;
  respuesta: 'confirma' | 'cancela' | 'pide_cambio' | null;
  respondidoEn: Date | null;
  /** `paciente` o el id del usuario de recepción. */
  respondidoPor: string | null;
}

export interface ConfigParaPantalla {
  modo: ModoRecordatorios;
  horaEnvio: string;
  plantillas: Plantillas;
}

const hayCorreo = (email: string | null): email is string => email !== null && email.trim().length > 0;

/** Campos de las plantillas para esa cita y consultorio. */
export function datosDePlantilla(cita: CitaParaRecordatorio, consultorio: ConsultorioParaMensaje): DatosPlantilla {
  const { fecha, hora } = fechaYHoraLocal(cita.inicio, consultorio.zonaHoraria);
  return {
    paciente: cita.contacto.nombre,
    fecha,
    hora,
    medico: cita.medicoNombre,
    consultorio: consultorio.nombreMostrado,
    telefono_consultorio: consultorio.telefono ?? '',
  };
}

/** Mensaje de WhatsApp rellenado y su enlace `wa.me` (`null` si el teléfono no es válido para el país). */
export function armarWhatsApp(cita: CitaParaRecordatorio, consultorio: ConsultorioParaMensaje, plantilla: string): { mensaje: string; enlace: string | null } {
  const mensaje = rellenar(plantilla, datosDePlantilla(cita, consultorio), { html: false });
  return { mensaje, enlace: enlaceWhatsApp(cita.contacto.telefono, consultorio.pais, mensaje) };
}

/** Fila de la pantalla "Recordatorios" de una cita; `envios` son los de esa cita en su fecha local. */
export function armarRecordatorio(e: { cita: CitaParaRecordatorio; consultorio: ConsultorioParaMensaje; config: ConfigParaPantalla; envios: EnvioDeCita[]; ahora: DateTime }): RecordatorioCita {
  const { cita, consultorio, config, envios, ahora } = e;
  const fecha = fechaCitaLocal(cita.inicio, consultorio.zonaHoraria);
  const datos = datosDePlantilla(cita, consultorio);

  const correo = envios.find((x) => x.canal === 'correo');
  const whatsapp = envios.find((x) => x.canal === 'whatsapp_asistido');
  const estadoCorreo = hayCorreo(cita.contacto.email) ? (correo?.estado ?? 'pendiente') : 'sin_correo';

  const { mensaje: mensajeWhatsApp, enlace } = armarWhatsApp(cita, consultorio, config.plantillas.whatsapp);

  const ultima = envios
    .filter((x) => x.respuesta !== null && x.respondidoEn !== null)
    .sort((a, b) => b.respondidoEn!.getTime() - a.respondidoEn!.getTime())[0];

  return {
    citaId: cita.citaId,
    fecha,
    inicio: cita.inicio,
    paciente: cita.contacto.nombre,
    medico: cita.medicoNombre,
    estadoCita: cita.estado,
    pideCambio: cita.pideCambio,
    correo: {
      estado: estadoCorreo,
      sinAprobarYVencido: estadoCorreo !== 'sin_correo' && sinAprobarYVencido(ahora, consultorio.zonaHoraria, config.modo, config.horaEnvio, fecha, estadoCorreo),
      vistaPrevia:
        estadoCorreo === 'sin_correo'
          ? null
          : { asunto: rellenar(config.plantillas.correoAsunto, datos, { html: false }), texto: rellenar(config.plantillas.correoCuerpo, datos, { html: false }) },
    },
    whatsapp: { abierto: whatsapp?.estado === 'enviado', enlace, motivo: enlace === null ? 'telefono_invalido' : null, vistaPrevia: mensajeWhatsApp },
    respuesta: ultima?.respuesta
      ? { valor: ultima.respuesta, canal: ultima.canal, origen: ultima.respondidoPor === 'paciente' ? 'paciente' : 'recepcion', respondidoEn: ultima.respondidoEn!.toISOString() }
      : null,
  };
}

export interface CambiosConfig {
  modo?: ModoRecordatorios | undefined;
  horaEnvio?: string | undefined;
  plantillas?: Partial<Plantillas> | undefined;
}

/** Aplica los cambios recibidos sobre la configuración actual y lista los campos que de verdad cambian (para el evento de bitácora). */
export function cambiosDeConfig(actual: ConfigParaPantalla, cambios: CambiosConfig): { nueva: ConfigParaPantalla; campos: string[] } {
  const nueva: ConfigParaPantalla = {
    modo: cambios.modo ?? actual.modo,
    horaEnvio: cambios.horaEnvio ?? actual.horaEnvio,
    plantillas: {
      correoAsunto: cambios.plantillas?.correoAsunto ?? actual.plantillas.correoAsunto,
      correoCuerpo: cambios.plantillas?.correoCuerpo ?? actual.plantillas.correoCuerpo,
      whatsapp: cambios.plantillas?.whatsapp ?? actual.plantillas.whatsapp,
    },
  };
  const campos: string[] = [];
  if (nueva.modo !== actual.modo) campos.push('modo');
  if (nueva.horaEnvio.slice(0, 5) !== actual.horaEnvio.slice(0, 5)) campos.push('horaEnvio');
  if (nueva.plantillas.correoAsunto !== actual.plantillas.correoAsunto) campos.push('plantillaCorreoAsunto');
  if (nueva.plantillas.correoCuerpo !== actual.plantillas.correoCuerpo) campos.push('plantillaCorreoCuerpo');
  if (nueva.plantillas.whatsapp !== actual.plantillas.whatsapp) campos.push('plantillaWhatsapp');
  return { nueva, campos };
}
