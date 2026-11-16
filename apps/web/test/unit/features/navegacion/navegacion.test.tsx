import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { opcionesDeMenu } from '@/features/navegacion/menu';

const ruta = vi.hoisted(() => ({ actual: '/agenda' }));
vi.mock('next/navigation', () => ({ usePathname: () => ruta.actual }));
vi.mock('@/features/sesion/actions', () => ({ cerrarSesion: vi.fn() }));

const { BarraDeNavegacion } = await import('@/features/navegacion/components/BarraDeNavegacion');

const USUARIO = '0190a0a0-0000-7000-8000-00000000000a';
const claims = (rol: 'medico' | 'recepcion', admin: boolean) => ({ sub: USUARIO, tid: 't', rol, admin, mfa: true });

afterEach(cleanup);

describe('opcionesDeMenu', () => {
  test('recepción: agenda, mi día, médicos, recordatorios y perfil', () => {
    expect(opcionesDeMenu(claims('recepcion', false)).map((o) => [o.texto, o.href])).toEqual([
      ['Agenda', '/agenda'],
      ['Mi día', '/mi-dia'],
      ['Médicos', '/medicos'],
      ['Recordatorios', '/recordatorios'],
      ['Perfil', '/perfil'],
    ]);
  });

  test('médico sin admin: "Mi día" va primero; "Médicos" lleva a su propia página; sin Recordatorios, Equipo ni Bitácora', () => {
    const o = opcionesDeMenu(claims('medico', false));
    expect(o.map((x) => x.texto)).toEqual(['Mi día', 'Agenda', 'Médicos', 'Perfil']);
    expect(o.find((x) => x.texto === 'Médicos')?.href).toBe(`/medicos/${USUARIO}`);
  });

  test('admin ve Recordatorios, Mi consultorio, Equipo y Bitácora; Médicos va a la lista', () => {
    const medico = opcionesDeMenu(claims('medico', true));
    expect(medico.map((x) => x.texto)).toEqual(['Mi día', 'Agenda', 'Médicos', 'Recordatorios', 'Mi consultorio', 'Equipo', 'Bitácora', 'Perfil']);
    const recepcion = opcionesDeMenu(claims('recepcion', true));
    expect(recepcion.map((x) => x.texto)).toEqual(['Agenda', 'Mi día', 'Médicos', 'Recordatorios', 'Mi consultorio', 'Equipo', 'Bitácora', 'Perfil']);
    for (const o of [medico, recepcion]) {
      expect(o.find((x) => x.texto === 'Médicos')?.href).toBe('/medicos');
      expect(o.find((x) => x.texto === 'Mi consultorio')?.href).toBe('/consultorio');
      expect(o.find((x) => x.texto === 'Recordatorios')?.href).toBe('/recordatorios');
    }
  });
});

describe('BarraDeNavegacion', () => {
  test('muestra las opciones, marca la actual y ofrece cerrar sesión', () => {
    render(<BarraDeNavegacion opciones={opcionesDeMenu(claims('recepcion', true))} consultorio="Dental Sol" consultorioId={USUARIO} logoVersion={0} />);
    expect(screen.getByText('Dental Sol')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Equipo' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  test('una subruta mantiene marcada su sección', () => {
    ruta.actual = `/medicos/${USUARIO}`;
    render(<BarraDeNavegacion opciones={opcionesDeMenu(claims('medico', false))} consultorio="X" consultorioId={USUARIO} logoVersion={0} />);
    expect(screen.getByRole('link', { name: 'Médicos' })).toHaveAttribute('aria-current', 'page');
    ruta.actual = '/agenda';
  });
});
