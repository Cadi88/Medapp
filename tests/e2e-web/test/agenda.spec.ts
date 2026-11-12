import { expect, test } from '@playwright/test';
import {
  agendarCita,
  arrastrarEventoA,
  configurarHorarioYTipo,
  eventoDe,
  fechaFutura,
  horaDelCalendario,
  irASemanaDe,
  registrarYEntrar,
} from './apoyo.js';

test('horario y tipo → cita desde un hueco → móvil → arrastrar para reprogramar → cancelar → bitácora', async ({ page }) => {
  const zona = 'America/Mexico_City';
  const doctora = await registrarYEntrar(page);
  await configurarHorarioYTipo(page, doctora.nombre);

  const fecha = fechaFutura(zona);
  const paciente = 'Paciente Arrastre';
  const horaCreada = await test.step('agendar desde un hueco sugerido', async () => {
    const hora = await agendarCita(page, { fecha, paciente, indiceHueco: 2 });
    await irASemanaDe(page, fecha);
    await expect(eventoDe(page, paciente)).toBeVisible();
    await expect(eventoDe(page, paciente).locator('.fc-event-time')).toHaveText(horaDelCalendario(hora));
    return hora;
  });
  expect(horaCreada).not.toBe('15:00');

  await test.step('a 375 px la agenda muestra la lista del día y no la cuadrícula', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    const lista = page.getByRole('region', { name: 'Citas del día' });
    await expect(lista).toBeVisible();
    await expect(page.locator('.fc')).toHaveCount(0);
    for (let i = 0; i < 8; i++) await lista.getByRole('button', { name: 'Día siguiente' }).click();
    await expect(lista.getByRole('button', { name: new RegExp(paciente) })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 1600 });
    await expect(page.locator('.fc-timegrid')).toBeVisible();
  });

  await test.step('arrastrar la cita a las 15:00 la reprograma', async () => {
    await irASemanaDe(page, fecha);
    await arrastrarEventoA(page, eventoDe(page, paciente), '15:00');
    // Un instante pueden verse la cita vieja y la movida: se espera a que quede una sola.
    await expect(eventoDe(page, paciente)).toHaveCount(1);
    await expect(eventoDe(page, paciente).locator('.fc-event-time')).toHaveText(horaDelCalendario('15:00'));
    await eventoDe(page, paciente).click();
    const detalle = page.getByRole('dialog', { name: 'Cita' });
    await expect(detalle.getByText(/15:00–15:30/)).toBeVisible();
    // Sigue en pie tras recargar: quedó guardada en el servidor, no solo en pantalla.
    await page.keyboard.press('Escape');
    await page.reload();
    await irASemanaDe(page, fecha);
    await expect(eventoDe(page, paciente).locator('.fc-event-time')).toHaveText(horaDelCalendario('15:00'));
  });

  await test.step('cancelar la cita', async () => {
    await eventoDe(page, paciente).click();
    const detalle = page.getByRole('dialog', { name: 'Cita' });
    await detalle.getByRole('button', { name: 'Cancelar cita' }).click();
    await expect(detalle).toBeHidden();
    await eventoDe(page, paciente).click();
    await expect(page.getByRole('dialog', { name: 'Cita' }).getByText('Cancelada')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Cita' }).getByRole('button', { name: 'Reprogramar' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  await test.step('la bitácora muestra creación, reprogramación y cancelación', async () => {
    await page.goto('/bitacora');
    // Los eventos llegan a auditoría por NATS: pueden tardar un instante.
    await expect(async () => {
      await page.reload();
      for (const accion of ['Cita creada', 'Cita reprogramada', 'Cita cancelada']) {
        await expect(page.getByRole('cell', { name: accion, exact: true }).first()).toBeVisible({ timeout: 2_000 });
      }
    }).toPass({ timeout: 45_000 });
  });
});

test('la zona horaria del consultorio manda, no la del navegador', async ({ browser }) => {
  // Consultorio en Tijuana (UTC-8/-7) visto desde un navegador en Tokio (UTC+9): 15 o 16 horas de diferencia.
  const zona = 'America/Tijuana';
  const contexto = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'es-MX', viewport: { width: 1280, height: 1600 } });
  const page = await contexto.newPage();
  const doctora = await registrarYEntrar(page, { zona });
  await configurarHorarioYTipo(page, doctora.nombre);

  const fecha = fechaFutura(zona);
  const paciente = 'Paciente Tijuana';
  const hora = await agendarCita(page, { fecha, paciente, indiceHueco: 2 });
  // La jornada va de 08:00 a 20:00 hora de Tijuana: el hueco ofrecido cae dentro de ella.
  expect(hora >= '08:00' && hora < '20:00').toBe(true);

  await irASemanaDe(page, fecha);
  // El evento está en la columna del día elegido (en Tijuana) y a la hora elegida, aunque el navegador esté en Tokio.
  const evento = eventoDe(page, paciente);
  await expect(evento).toBeVisible();
  await expect(evento.locator('.fc-event-time')).toHaveText(horaDelCalendario(hora));
  const columna = await page.locator(`.fc-col-header-cell[data-date="${fecha}"]`).boundingBox();
  const caja = await evento.boundingBox();
  expect(columna && caja && caja.x >= columna.x - 1 && caja.x + caja.width <= columna.x + columna.width + 1).toBe(true);

  await evento.click();
  const detalle = page.getByRole('dialog', { name: 'Cita' });
  await expect(detalle.getByText(new RegExp(`${hora}–`))).toBeVisible();
  await contexto.close();
});
