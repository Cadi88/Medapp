import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { altaMiembro, cambiarPasswordTemporal, encabezadoAgenda, iniciarSesion, PASSWORD, registrarYEntrar, titulo } from './apoyo.js';

const LOGO = fileURLToPath(new URL('./fixtures/logo.png', import.meta.url));
const VERDE = '#0f766e';
const VERDE_RGB = 'rgb(15, 118, 110)';

test('el admin elige un color y sube el logo: el encabezado muestra el logo y los botones primarios toman el color', async ({ page }) => {
  const admin = await registrarYEntrar(page);
  const menu = page.getByRole('navigation', { name: 'Principal' });
  await menu.getByRole('link', { name: 'Mi consultorio' }).click();
  await expect(page).toHaveURL(/\/consultorio$/);
  await expect(page.getByRole('heading', { name: 'Mi consultorio', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: `Color ${VERDE}` }).click();
  await expect(page.getByRole('button', { name: `Color ${VERDE}` })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados' })).toBeVisible();

  await page.getByLabel('Archivo del logo').setInputFiles(LOGO);
  await expect(page.getByRole('status').filter({ hasText: 'Logo actualizado' })).toBeVisible();

  // El logo llega por Next (nunca por el almacenamiento) y se pinta de verdad: no es una imagen rota.
  const logoEncabezado = page.getByRole('banner').getByRole('img', { name: `Logo de Consultorio ${admin.slug}` });
  await expect(logoEncabezado).toBeVisible();
  await expect.poll(() => logoEncabezado.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(64);

  // El botón primario usa el color del consultorio como fondo (variable --primary).
  const guardar = page.getByRole('button', { name: 'Guardar cambios' });
  await expect.poll(() => guardar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(VERDE_RGB);

  // Sigue ahí tras recargar (viene del servidor, no del estado del formulario).
  await page.reload();
  await expect(page.getByRole('banner').getByRole('img', { name: /Logo de/ })).toBeVisible();
  await expect.poll(() => page.getByRole('button', { name: 'Guardar cambios' }).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(VERDE_RGB);

  // Quitar el logo deja solo el nombre.
  await page.getByRole('button', { name: 'Quitar' }).click();
  await expect(page.getByRole('banner').getByRole('img')).toHaveCount(0);
  await expect(page.getByText('Sin logo')).toBeVisible();
});

test('la recepción no ve "Mi consultorio" y /consultorio la lleva a /sin-acceso', async ({ page, browser }) => {
  const admin = await registrarYEntrar(page);
  const recepcion = { email: `recepcion@${admin.slug}.mx`, password: 'temporal-e2e-12345' };
  await altaMiembro(page, { nombre: 'Rita Recepción', email: recepcion.email, rol: 'recepcion', passwordTemporal: recepcion.password });

  const contexto = await browser.newContext();
  const ella = await contexto.newPage();
  await iniciarSesion(ella, recepcion, titulo(ella, 'Cambia tu contraseña'));
  await cambiarPasswordTemporal(ella, recepcion.password, PASSWORD, encabezadoAgenda(ella));

  const menu = ella.getByRole('navigation', { name: 'Principal' });
  await expect(menu.getByRole('link', { name: 'Agenda' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Mi consultorio' })).toHaveCount(0);

  await ella.goto('/consultorio');
  await expect(ella).toHaveURL(/\/sin-acceso$/);
  await expect(titulo(ella, 'No tienes acceso')).toBeVisible();
  await contexto.close();
});
