import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { agendarCita, configurarHorarioYTipo, eventoDe, fechaFutura, irASemanaDe, registrarYEntrar } from './apoyo.js';

/** Buzón de desarrollo donde llegan los correos (el stack usa Mailpit: nunca sale un correo real). */
const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
const ZONA = 'America/Mexico_City';

interface MensajeMailpit {
  ID: string;
  To: { Address: string }[];
}

/** Vacía el buzón para que lo que se lea después sea de esta prueba. */
async function vaciarBuzon(request: APIRequestContext): Promise<void> {
  const r = await request.delete(`${MAILPIT}/api/v1/messages`);
  expect(r.ok()).toBe(true);
}

/** Espera el correo dirigido a `destinatario` y devuelve su texto. */
async function esperarCorreo(request: APIRequestContext, destinatario: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/messages`);
        const { messages } = (await r.json()) as { messages: MensajeMailpit[] };
        id = messages.find((m) => m.To.some((t) => t.Address === destinatario))?.ID ?? '';
        return id;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .not.toBe('');
  const detalle = await request.get(`${MAILPIT}/api/v1/message/${id}`);
  return ((await detalle.json()) as { Text: string }).Text;
}

/** Cita de hoy, tarde: se pide con "Otra hora" y se confirma el aviso de fuera de jornada (el médico atiende hasta las 20:00). */
async function agendarCitaDeHoy(page: Page, paciente: string): Promise<void> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Nueva cita' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nueva cita' });
  const medico = dialogo.getByLabel('Médico');
  if ((await medico.inputValue()) === '') await medico.selectOption({ index: 1 });
  await dialogo.getByLabel('Tipo de cita').selectOption({ index: 1 });
  await dialogo.getByLabel('Fecha').fill(fechaFutura(ZONA, 0));
  await dialogo.getByLabel('Otra hora').fill('23:50');
  await dialogo.getByLabel('Nombre del paciente').fill(paciente);
  await dialogo.getByLabel('Teléfono').fill('5512345678');
  await dialogo.getByRole('button', { name: 'Agendar', exact: true }).click();
  await dialogo.getByRole('button', { name: 'Agendar de todos modos' }).click();
  await expect(dialogo).toBeHidden();
}

test('recordatorio: aprobar → correo en Mailpit → el paciente cancela desde el enlace → la agenda lo muestra cancelado; Mi día en el celular', async ({
  page,
  browser,
  request,
}) => {
  const doctora = await registrarYEntrar(page, { zona: ZONA });
  await configurarHorarioYTipo(page, doctora.nombre);

  await test.step('la encargada pone la hora de envío en 00:00 (el correo de mañana sale en cuanto se aprueba)', async () => {
    await page.goto('/consultorio');
    await page.getByLabel('Hora de envío').fill('00:00');
    await page.getByRole('button', { name: 'Guardar recordatorios' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recordatorios guardados' })).toBeVisible();
  });

  const paciente = 'Paciente Recordatorio';
  const correoPaciente = `paciente@${doctora.slug}.test`;
  const manana = fechaFutura(ZONA, 1);
  await vaciarBuzon(request);
  await agendarCita(page, { fecha: manana, paciente, email: correoPaciente });

  await test.step('en "Recordatorios" aparece sin aprobar; al aprobar sale el correo', async () => {
    await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Recordatorios' }).click();
    await expect(page.getByRole('heading', { name: 'Recordatorios', level: 1 })).toBeVisible();
    const fila = page.getByRole('listitem', { name: paciente });
    await expect(fila).toContainText('Sin aprobar');
    await fila.getByRole('button', { name: 'Aprobar' }).click();
    await expect(fila.getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
  });

  const texto = await esperarCorreo(request, correoPaciente);
  const enlace = /\/r\/[A-Za-z0-9_-]{43}/.exec(texto)?.[0];
  expect(enlace, 'el correo trae el enlace /r/{token}').toBeDefined();

  await test.step('el paciente (sin sesión) abre el enlace: ver la página no responde por él; elige Cancelar y confirma', async () => {
    const contexto = await browser.newContext();
    const paciente_ = await contexto.newPage();
    await paciente_.goto(enlace!);
    await expect(paciente_.getByRole('button', { name: 'Enviar respuesta' })).toBeDisabled();
    await paciente_.getByLabel('Cancelar mi cita').check();
    await paciente_.getByRole('button', { name: 'Enviar respuesta' }).click();
    await expect(paciente_.getByText('Gracias, recibimos tu respuesta')).toBeVisible();

    // Un solo uso: al volver a abrir el mismo enlace ya está respondida.
    await paciente_.goto(enlace!);
    await expect(paciente_.getByText('Esta cita ya fue respondida')).toBeVisible();
    await contexto.close();
  });

  await test.step('en la agenda la cita aparece cancelada', async () => {
    await page.goto('/agenda');
    // La respuesta llega a la agenda por un evento (NATS): puede tardar un instante.
    await expect(async () => {
      await page.reload();
      await irASemanaDe(page, manana);
      await eventoDe(page, paciente).click();
      await expect(page.getByRole('dialog', { name: 'Cita' }).getByText('Cancelada')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await page.keyboard.press('Escape');
  });

  await test.step('a 375 px "Mi día" muestra la cita de hoy del médico', async () => {
    const deHoy = 'Paciente De Hoy';
    await agendarCitaDeHoy(page, deHoy);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/mi-dia');
    await expect(page.getByRole('heading', { name: 'Mi día', level: 1 })).toBeVisible();
    const hoy = page.getByRole('region', { name: 'Hoy' });
    await expect(hoy.getByText(deHoy)).toBeVisible();
    // Sin desplazamiento horizontal: pensado para el celular.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
