import type { RecordatorioCita } from '@consultorio/contracts';

export const CITA_A = '0190a0a0-0000-7000-8000-0000000000a1';
export const CITA_B = '0190a0a0-0000-7000-8000-0000000000a2';
export const CITA_C = '0190a0a0-0000-7000-8000-0000000000a3';

/** Recordatorio con correo `pendiente` y WhatsApp disponible; `extra` cambia lo que cada prueba necesite. */
export function recordatorio(extra: Partial<RecordatorioCita> = {}): RecordatorioCita {
  return {
    citaId: CITA_A,
    fecha: '2026-11-16',
    // 16:00Z = 10:00 en Ciudad de México
    inicio: '2026-11-16T16:00:00.000Z',
    paciente: 'Ana Pérez',
    medico: 'Dra. Ruiz',
    estadoCita: 'agendada',
    pideCambio: false,
    correo: { estado: 'pendiente', sinAprobarYVencido: false, enviableAhora: false, vistaPrevia: { asunto: 'Recordatorio de tu cita', texto: 'Hola Ana, te esperamos.' } },
    whatsapp: { abierto: false, enlace: 'https://wa.me/525512345678?text=Hola', motivo: null, vistaPrevia: 'Hola Ana, ¿nos confirmas?' },
    respuesta: null,
    ...extra,
  };
}
