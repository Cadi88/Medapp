import '@testing-library/jest-dom/vitest';
import type { RecordatoriosRespuesta } from '@consultorio/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CITA_A, CITA_B, recordatorio } from './apoyo';

const m = vi.hoisted(() => ({
  aprobarRecordatorio: vi.fn(),
  aprobarTodos: vi.fn(),
  reintentarEnvio: vi.fn(),
  abrirWhatsApp: vi.fn(),
  registrarRespuestaRecepcion: vi.fn(),
}));
vi.mock('@/features/recordatorios/actions', () => m);

const { PanelRecordatorios } = await import('@/features/recordatorios/components/PanelRecordatorios');

const datos = (citas: RecordatoriosRespuesta['citas'], modo: RecordatoriosRespuesta['modo'] = 'con_revision'): RecordatoriosRespuesta => ({
  modo,
  horaEnvio: '10:00',
  citas,
});
const panel = (d: RecordatoriosRespuesta) => <PanelRecordatorios datos={d} desde="2026-11-16" hasta="2026-11-18" zona="America/Mexico_City" />;
const mostrar = (d: RecordatoriosRespuesta) => render(panel(d));
const fila = (nombre: string) => screen.getByRole('listitem', { name: nombre });

beforeEach(() => {
  vi.clearAllMocks();
  m.aprobarRecordatorio.mockResolvedValue({ ok: true });
  m.aprobarTodos.mockResolvedValue({ ok: true });
  m.reintentarEnvio.mockResolvedValue({ ok: true });
  m.registrarRespuestaRecepcion.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('encabezado y grupos', () => {
  test('modo y hora de envío arriba; citas agrupadas por fecha y médico con su hora local', () => {
    mostrar(datos([recordatorio(), recordatorio({ citaId: CITA_B, paciente: 'Luis Gómez', medico: 'Dr. Soto', fecha: '2026-11-17', inicio: '2026-11-17T17:00:00.000Z' })]));
    expect(screen.getByText(/Con revisión: solo se envía lo aprobado/)).toBeInTheDocument();
    expect(screen.getByText(/10:00/, { selector: '[data-testid="hora-envio"]' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /lunes, 16 de noviembre/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /martes, 17 de noviembre/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dra. Ruiz' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dr. Soto' })).toBeInTheDocument();
    expect(within(fila('Ana Pérez')).getByText('10:00')).toBeInTheDocument();
  });

  test('sin revisión describe el modo', () => {
    mostrar(datos([recordatorio()], 'sin_revision'));
    expect(screen.getByText(/Sin revisión: todo se envía solo/)).toBeInTheDocument();
  });

  test('sin citas lo dice', () => {
    mostrar(datos([]));
    expect(screen.getByText('No hay citas con recordatorio en estos días')).toBeInTheDocument();
  });

  test('muestra la vista previa del correo y del WhatsApp', () => {
    mostrar(datos([recordatorio()]));
    const f = fila('Ana Pérez');
    expect(within(f).getByText('Recordatorio de tu cita')).toBeInTheDocument();
    expect(within(f).getByText('Hola Ana, te esperamos.')).toBeInTheDocument();
    expect(within(f).getByText('Hola Ana, ¿nos confirmas?')).toBeInTheDocument();
  });
});

describe('estados', () => {
  test('"Sin aprobar — no se envió" cuando sinAprobarYVencido', () => {
    mostrar(datos([recordatorio({ correo: { estado: 'pendiente', sinAprobarYVencido: true, vistaPrevia: null } })]));
    expect(within(fila('Ana Pérez')).getByText('Sin aprobar — no se envió')).toBeInTheDocument();
  });

  test('"Sin correo — usa WhatsApp" cuando no hay correo y no hay botón de aprobar', () => {
    mostrar(datos([recordatorio({ correo: { estado: 'sin_correo', sinAprobarYVencido: false, vistaPrevia: null } })]));
    const f = fila('Ana Pérez');
    expect(within(f).getByText('Sin correo — usa WhatsApp')).toBeInTheDocument();
    expect(within(f).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  test('teléfono no válido: sin botón y con el aviso', () => {
    mostrar(datos([recordatorio({ whatsapp: { abierto: false, enlace: null, motivo: 'telefono_invalido', vistaPrevia: '' } })]));
    const f = fila('Ana Pérez');
    expect(within(f).getByText('Teléfono no válido para WhatsApp')).toBeInTheDocument();
    expect(within(f).queryByRole('button', { name: 'Abrir WhatsApp' })).not.toBeInTheDocument();
  });

  test('WhatsApp abierto, pide cambio y respuesta registrada', () => {
    mostrar(
      datos([
        recordatorio({
          pideCambio: true,
          whatsapp: { abierto: true, enlace: 'https://wa.me/1', motivo: null, vistaPrevia: 'x' },
          respuesta: { valor: 'confirma', canal: 'whatsapp_asistido', origen: 'recepcion', respondidoEn: '2026-11-15T20:00:00.000Z' },
        }),
      ]),
    );
    const f = fila('Ana Pérez');
    expect(within(f).getByText('WhatsApp abierto')).toBeInTheDocument();
    expect(within(f).getByText('Pide cambio')).toBeInTheDocument();
    expect(within(f).getByText('Confirmó (registrado por recepción)')).toBeInTheDocument();
    expect(within(f).queryByRole('button', { name: 'Canceló' })).not.toBeInTheDocument();
  });
});

describe('acciones', () => {
  test('Aprobar llama a la acción con la cita', async () => {
    mostrar(datos([recordatorio()]));
    await userEvent.click(within(fila('Ana Pérez')).getByRole('button', { name: 'Aprobar' }));
    expect(m.aprobarRecordatorio).toHaveBeenCalledWith(CITA_A, expect.any(Boolean));
  });

  test('Aprobar todos manda el rango mostrado y solo aparece con pendientes', async () => {
    const { unmount } = mostrar(datos([recordatorio(), recordatorio({ citaId: CITA_B, paciente: 'Luis Gómez' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar todos' }));
    expect(m.aprobarTodos).toHaveBeenCalledWith('2026-11-16', '2026-11-18');
    unmount();
    mostrar(datos([recordatorio({ correo: { estado: 'enviado', sinAprobarYVencido: false, vistaPrevia: null } })]));
    expect(screen.queryByRole('button', { name: 'Aprobar todos' })).not.toBeInTheDocument();
  });

  test('Reintentar solo con correo fallido; el error del servicio se muestra', async () => {
    m.reintentarEnvio.mockResolvedValue({ mensaje: 'La cita ya empezó; no se puede reenviar el recordatorio' });
    mostrar(datos([recordatorio({ correo: { estado: 'fallido', sinAprobarYVencido: false, vistaPrevia: null } })]));
    const f = fila('Ana Pérez');
    expect(within(f).getByText('No se pudo enviar')).toBeInTheDocument();
    await userEvent.click(within(f).getByRole('button', { name: 'Reintentar' }));
    expect(m.reintentarEnvio).toHaveBeenCalledWith(CITA_A);
    expect(await screen.findByRole('alert')).toHaveTextContent('La cita ya empezó; no se puede reenviar el recordatorio');
  });

  test('los botones de respuesta registran con la fecha local de la cita', async () => {
    mostrar(datos([recordatorio()]));
    const f = fila('Ana Pérez');
    await userEvent.click(within(f).getByRole('button', { name: 'Confirmó' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Canceló' }));
    await userEvent.click(within(f).getByRole('button', { name: 'Pide cambio' }));
    expect(m.registrarRespuestaRecepcion.mock.calls).toEqual([
      [CITA_A, '2026-11-16', 'confirma'],
      [CITA_A, '2026-11-16', 'cancela'],
      [CITA_A, '2026-11-16', 'pide_cambio'],
    ]);
  });

});
