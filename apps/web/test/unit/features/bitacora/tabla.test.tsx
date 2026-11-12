import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EventoAuditoria } from '@/features/bitacora/tipos';

const acciones = vi.hoisted(() => ({ cargarMasEventos: vi.fn() }));
vi.mock('@/features/bitacora/actions', () => acciones);

const { TablaBitacora } = await import('@/features/bitacora/components/TablaBitacora');

const evento = (n: number, extra: Partial<EventoAuditoria> = {}): EventoAuditoria => ({
  id: `e${n}`,
  secuencia: String(n),
  ocurrido_en: '2026-11-12T16:00:00.000Z',
  actor_id: 'a1',
  accion: 'cita.creada',
  recurso_tipo: 'cita',
  recurso_id: 'r1',
  servicio: 'svc-agenda',
  ...extra,
});

beforeEach(() => acciones.cargarMasEventos.mockReset());
afterEach(cleanup);

describe('TablaBitacora', () => {
  const props = { nombres: { a1: 'Dra. Ruiz' }, zona: 'America/Mexico_City', filtros: {} };

  test('resuelve nombres, muestra "Sistema" sin actor, etiqueta legible y fecha en la zona del consultorio', () => {
    render(
      <TablaBitacora
        {...props}
        eventos={[evento(2), evento(1, { actor_id: null, accion: 'tenant.creado' }), evento(0, { accion: 'rara.cosa' })]}
        siguiente={null}
      />,
    );
    const filas = screen.getAllByRole('row').slice(1);
    expect(within(filas[0] as HTMLElement).getByText('Dra. Ruiz')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText('Cita creada')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText(/12 nov 2026.*10:00/)).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Sistema')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('Consultorio creado')).toBeInTheDocument();
    expect(within(filas[2] as HTMLElement).getByText('rara.cosa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
  });

  test('sin eventos avisa que no hay movimientos', () => {
    render(<TablaBitacora {...props} eventos={[]} siguiente={null} />);
    expect(screen.getByText('No hay movimientos con estos filtros')).toBeInTheDocument();
  });

  test('"Ver más" pide la página siguiente con los filtros y agrega las filas', async () => {
    acciones.cargarMasEventos.mockResolvedValueOnce({ ok: true, eventos: [evento(1, { accion: 'cita.cancelada' })], siguiente: null });
    render(<TablaBitacora {...props} filtros={{ accion: 'cita.creada' }} eventos={[evento(2)]} siguiente={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    expect(await screen.findByText('Cita cancelada')).toBeInTheDocument();
    expect(acciones.cargarMasEventos).toHaveBeenCalledWith({ accion: 'cita.creada' }, 2);
    expect(screen.getByText('Cita creada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver más' })).not.toBeInTheDocument();
  });

  test('si falla "Ver más" muestra el mensaje y conserva lo cargado', async () => {
    acciones.cargarMasEventos.mockResolvedValueOnce({ ok: false, mensaje: 'Ocurrió un error. Intenta de nuevo.' });
    render(<TablaBitacora {...props} eventos={[evento(2)]} siguiente={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver más' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ocurrió un error');
    expect(screen.getByRole('button', { name: 'Ver más' })).toBeInTheDocument();
  });
});
