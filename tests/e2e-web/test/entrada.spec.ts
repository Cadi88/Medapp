import { expect, test } from '@playwright/test';
import {
  altaMiembro,
  cambiarPasswordTemporal,
  encabezadoAgenda,
  iniciarSesion,
  PASSWORD,
  registrarYEntrar,
  titulo,
  verificarTotp,
} from './apoyo.js';

test('registro → MFA → agenda vacía, y el siguiente acceso pasa por /login/mfa', async ({ page, browser }) => {
  const cuenta = await registrarYEntrar(page);
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(page.getByRole('button', { name: 'Nueva cita' })).toBeVisible();
  await expect(page.locator('.fc-timegrid')).toBeVisible();
  await expect(page.locator('.fc-event')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Equipo' })).toBeVisible();

  await test.step('un acceso nuevo: /login → /login/mfa → /agenda (cookie de dos factores)', async () => {
    const contexto = await browser.newContext();
    const otra = await contexto.newPage();
    await iniciarSesion(otra, cuenta, titulo(otra, 'Verificación en dos pasos'));
    await expect(otra).toHaveURL(/\/login\/mfa$/);
    await verificarTotp(otra, cuenta.secreto ?? '', encabezadoAgenda(otra));
    await expect(otra).toHaveURL(/\/agenda$/);
    await contexto.close();
  });
});

test('el admin da de alta a una recepcionista con contraseña temporal; ella la cambia y llega a la agenda', async ({ page, browser }) => {
  const admin = await registrarYEntrar(page);
  const recepcion = { email: `recepcion@${admin.slug}.mx`, password: 'temporal-e2e-12345' };
  await altaMiembro(page, { nombre: 'Rita Recepción', email: recepcion.email, rol: 'recepcion', passwordTemporal: recepcion.password });
  await expect(page.getByText(recepcion.email)).toBeVisible();

  const contexto = await browser.newContext();
  const ella = await contexto.newPage();
  await iniciarSesion(ella, recepcion, titulo(ella, 'Cambia tu contraseña'));
  await expect(ella).toHaveURL(/\/cambiar-password$/);

  await cambiarPasswordTemporal(ella, recepcion.password, PASSWORD, encabezadoAgenda(ella));
  await expect(ella).toHaveURL(/\/agenda$/);
  await expect(ella.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Agenda' })).toBeVisible();
  await contexto.close();
});
