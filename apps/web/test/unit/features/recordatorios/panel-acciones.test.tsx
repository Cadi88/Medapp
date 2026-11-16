import '@testing-library/jest-dom/vitest';
import type { RecordatoriosRespuesta } from '@consultorio/contracts';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CITA_A, recordatorio } from './apoyo';

const m = vi.hoisted(() => ({
  aprobarRecordatorio: vi.fn(),
  aprobarTodos: vi.fn(),
  reintentarEnvio: vi.fn(),
  abrirWhatsApp: vi.fn(),
  registrarRespuestaRecepcion: vi.fn(),
}));
vi.mock('@/features/recordatorios/actions', () => m);

const { PanelRecordatorios } = await import('@/features/recordatorios/components/PanelRecordatorios');

const datos = (citas: RecordatoriosRespuesta['citas']): RecordatoriosRespuesta => ({ modo: 'con_revision', horaEnvio: '10:00', citas });
const panel = (d: RecordatoriosRespuesta) => <PanelRecordatorios datos={d} desde="2026-11-16" hasta="2026-11-18" zona="America/Mexico_City" />;
const fila = () => screen.getByRole('listitem', { name: 'Ana Pérez' });
const aprobado = recordatorio({ correo: { estado: 'aprobado', sinAprobarYVencido: false, vistaPrevia: null } });

beforeEach(() => {
  vi.clearAllMocks();
  m.aprobarRecordatorio.mockResolvedValue({ ok: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Enviar ahora y la hora de envío', () => {
  test('un correo aprobado que no ha salido ofrece "Enviar ahora" (misma acción de aprobar)', async () => {
    render(panel(datos([aprobado])));
    await userEvent.click(within(fila()).getByRole('button', { name: 'Enviar ahora' }));
    expect(m.aprobarRecordatorio).toHaveBeenCalledWith(CITA_A, expect.any(Boolean));
    expect(within(fila()).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  test('la acción sabe si ya pasó la hora de envío del día anterior (zona del consultorio)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-15 17:00 local: ya pasó las 10:00 del día anterior a la cita del 16
    vi.setSystemTime(new Date('2026-11-15T23:00:00Z'));
    render(panel(datos([recordatorio()])));
    await userEvent.click(within(fila()).getByRole('button', { name: 'Aprobar' }));
    expect(m.aprobarRecordatorio).toHaveBeenLastCalledWith(CITA_A, true);
    cleanup();
    // 2026-11-15 06:00 local: todavía no
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
    render(panel(datos([recordatorio()])));
    await userEvent.click(within(fila()).getByRole('button', { name: 'Aprobar' }));
    expect(m.aprobarRecordatorio).toHaveBeenLastCalledWith(CITA_A, false);
  });

  test('si la acción avisa que no salió, se muestra', async () => {
    m.aprobarRecordatorio.mockResolvedValue({ mensaje: 'No se pudo enviar' });
    render(panel(datos([aprobado])));
    await userEvent.click(within(fila()).getByRole('button', { name: 'Enviar ahora' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo enviar');
  });

  test('una acción que lanza muestra el aviso general y deja volver a intentar', async () => {
    m.aprobarRecordatorio.mockRejectedValueOnce(new Error('red caída'));
    render(panel(datos([recordatorio()])));
    await userEvent.click(within(fila()).getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error. Intenta de nuevo.');
    expect(within(fila()).getByRole('button', { name: 'Aprobar' })).toBeEnabled();
  });
});

describe('Abrir WhatsApp', () => {
  const ventana = () => ({ opener: {} as unknown, location: { href: '' }, close: vi.fn() });
  const abrirWhatsApp = () => userEvent.click(within(fila()).getByRole('button', { name: 'Abrir WhatsApp' }));

  test('abre la pestaña al instante, registra, y solo entonces la manda a wa.me; luego la fila dice "WhatsApp abierto"', async () => {
    const orden: string[] = [];
    const w = ventana();
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => {
      orden.push('ventana');
      return w as unknown as Window;
    });
    m.abrirWhatsApp.mockImplementation(async () => {
      orden.push('registro');
      expect(w.location.href).toBe('');
      return { ok: true, enlace: 'https://wa.me/525512345678?text=Hola' };
    });
    const { rerender } = render(panel(datos([recordatorio()])));
    await abrirWhatsApp();
    await waitFor(() => expect(w.location.href).toBe('https://wa.me/525512345678?text=Hola'));
    expect(abrir).toHaveBeenCalledWith('about:blank', '_blank');
    expect(m.abrirWhatsApp).toHaveBeenCalledWith(CITA_A, '2026-11-16');
    expect(orden).toEqual(['ventana', 'registro']);
    expect(w.opener).toBeNull();
    expect(w.close).not.toHaveBeenCalled();
    // la pantalla se vuelve a leer tras la acción
    rerender(panel(datos([recordatorio({ whatsapp: { abierto: true, enlace: 'https://wa.me/1', motivo: null, vistaPrevia: 'x' } })])));
    expect(within(fila()).getByText('WhatsApp abierto')).toBeInTheDocument();
  });

  test('si no se pudo registrar cierra la pestaña vacía y avisa', async () => {
    const w = ventana();
    vi.spyOn(window, 'open').mockImplementation(() => w as unknown as Window);
    m.abrirWhatsApp.mockResolvedValue({ mensaje: 'Teléfono no válido para WhatsApp' });
    render(panel(datos([recordatorio()])));
    await abrirWhatsApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Teléfono no válido para WhatsApp');
    expect(w.close).toHaveBeenCalled();
    expect(w.location.href).toBe('');
  });

  test('si la acción lanza, también cierra la pestaña vacía', async () => {
    const w = ventana();
    vi.spyOn(window, 'open').mockImplementation(() => w as unknown as Window);
    m.abrirWhatsApp.mockRejectedValue(new Error('x'));
    render(panel(datos([recordatorio()])));
    await abrirWhatsApp();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(w.close).toHaveBeenCalled();
  });

  test('si el navegador bloqueó la pestaña, al registrar ofrece un enlace para tocar', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    m.abrirWhatsApp.mockResolvedValue({ ok: true, enlace: 'https://wa.me/525512345678?text=Hola' });
    render(panel(datos([recordatorio()])));
    await abrirWhatsApp();
    const enlace = await screen.findByRole('link', { name: 'Abrir WhatsApp' });
    expect(enlace).toHaveAttribute('href', 'https://wa.me/525512345678?text=Hola');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('bloqueada y con error: no hay enlace', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    m.abrirWhatsApp.mockResolvedValue({ mensaje: 'x' });
    render(panel(datos([recordatorio()])));
    await abrirWhatsApp();
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: 'Abrir WhatsApp' })).not.toBeInTheDocument();
  });
});
