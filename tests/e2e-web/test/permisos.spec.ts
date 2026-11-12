import { expect, test } from '@playwright/test';
import {
  activarMfa,
  agendarCita,
  altaMiembro,
  cambiarPasswordTemporal,
  configurarHorarioYTipo,
  encabezadoAgenda,
  fechaFutura,
  iniciarSesion,
  irASemanaDe,
  PASSWORD,
  registrarYEntrar,
  titulo,
} from './apoyo.js';

const ZONA = 'America/Mexico_City';

test('la recepción no ve "Equipo" ni entra a /equipo: llega a /sin-acceso', async ({ page, browser }) => {
  const admin = await registrarYEntrar(page);
  const recepcion = { email: `recepcion@${admin.slug}.mx`, password: 'temporal-e2e-12345' };
  await altaMiembro(page, { nombre: 'Rita Recepción', email: recepcion.email, rol: 'recepcion', passwordTemporal: recepcion.password });

  const contexto = await browser.newContext();
  const ella = await contexto.newPage();
  await iniciarSesion(ella, recepcion, titulo(ella, 'Cambia tu contraseña'));
  await cambiarPasswordTemporal(ella, recepcion.password, PASSWORD, encabezadoAgenda(ella));

  const menu = ella.getByRole('navigation', { name: 'Principal' });
  await expect(menu.getByRole('link', { name: 'Agenda' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Equipo' })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Bitácora' })).toHaveCount(0);

  await ella.goto('/equipo');
  await expect(ella).toHaveURL(/\/sin-acceso$/);
  await expect(titulo(ella, 'No tienes acceso')).toBeVisible();
  await contexto.close();
});

test('un segundo médico no ve las citas del primero', async ({ page, browser }) => {
  const primero = await registrarYEntrar(page, { nombre: 'Doctora Uno' });
  await configurarHorarioYTipo(page, 'Doctora Uno');
  const fecha = fechaFutura(ZONA);
  await agendarCita(page, { fecha, paciente: 'Paciente Reservado' });
  await irASemanaDe(page, fecha);
  await expect(page.locator('.fc-event', { hasText: 'Paciente Reservado' })).toBeVisible();

  const segundo = { email: `medico2@${primero.slug}.mx`, password: 'temporal-e2e-12345' };
  await altaMiembro(page, { nombre: 'Doctor Dos', email: segundo.email, rol: 'medico', passwordTemporal: segundo.password });

  const contexto = await browser.newContext();
  const otro = await contexto.newPage();
  await iniciarSesion(otro, segundo, titulo(otro, 'Cambia tu contraseña'));
  // Es médico: tras cambiar la contraseña debe activar el MFA antes de llegar a la agenda.
  await cambiarPasswordTemporal(otro, segundo.password, PASSWORD, titulo(otro, 'Protege tu cuenta'));
  await activarMfa(otro, PASSWORD);

  await expect(otro.getByRole('button', { name: 'Nueva cita' })).toBeVisible();
  await irASemanaDe(otro, fecha);
  await expect(otro.locator('.fc-event')).toHaveCount(0);
  await expect(otro.getByText('Paciente Reservado')).toHaveCount(0);
  await contexto.close();
});
