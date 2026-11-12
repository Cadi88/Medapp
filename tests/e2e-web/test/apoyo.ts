import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { generate } from 'otplib';

export const PASSWORD = 'clave-e2e-segura-123';
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

/** Slug único por ejecución: las repeticiones no chocan con consultorios anteriores. */
export const slugUnico = (prefijo: string): string => `${prefijo}-${randomUUID().slice(0, 8)}`;

/** Código TOTP vigente para un secreto base32. */
export const codigoTotp = (secreto: string): Promise<string> => generate({ secret: secreto, strategy: 'totp' });

/** Día `YYYY-MM-DD` que será `dias` días después de ahora en la zona indicada (la del consultorio, no la del navegador). */
export function fechaFutura(zona: string, dias = 8): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    Date.now() + dias * 86_400_000,
  );
}

export interface Cuenta {
  slug: string;
  email: string;
  nombre: string;
  password: string;
  /** Secreto TOTP; solo si la cuenta ya activó el MFA. */
  secreto?: string;
}

/**
 * Envía un formulario de entrada y espera `listo`. Better Auth limita los accesos por IP (unos pocos cada 10 s) y el
 * sitio lo avisa con "Demasiados intentos": se espera lo que haga falta y se vuelve a intentar (`intento` rellena y envía).
 */
async function enviarRespetandoLimite(page: Page, intento: () => Promise<void>, listo: Locator): Promise<void> {
  const limite = page.getByText('Demasiados intentos');
  for (let i = 0; i < 5; i++) {
    await intento();
    const resultado = await Promise.race([
      listo.waitFor({ timeout: 20_000 }).then(() => 'listo' as const),
      limite.waitFor({ timeout: 20_000 }).then(() => 'limite' as const),
    ]);
    if (resultado === 'listo') return;
    // Se recarga para borrar el aviso anterior: si no, el siguiente intento lo vería como si fuera nuevo.
    await page.waitForTimeout(11_000);
    await page.reload();
  }
  await expect(listo).toBeVisible();
}

const tituloAgenda = (page: Page): Locator => page.getByRole('heading', { name: 'Agenda', level: 1 });

/**
 * Registra un consultorio y entra: registro → configurar MFA (se lee la clave que muestra la pantalla y se genera el
 * código con otplib) → agenda.
 */
export async function registrarYEntrar(
  page: Page,
  o: { slug?: string; zona?: string; esMedico?: boolean; nombre?: string } = {},
): Promise<Cuenta> {
  const slug = o.slug ?? slugUnico('e2e');
  const cuenta: Cuenta = { slug, email: `admin@${slug}.mx`, nombre: o.nombre ?? 'Doctora Prueba', password: PASSWORD };

  await page.goto('/registro');
  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Nombre del consultorio').fill(`Consultorio ${slug}`);
      await page.getByLabel('Identificador (slug)').fill(slug);
      if (o.zona) await page.getByLabel('Zona horaria').selectOption(o.zona);
      await page.getByLabel('Tu nombre').fill(cuenta.nombre);
      await page.getByLabel('Correo electrónico').fill(cuenta.email);
      await page.getByLabel('Contraseña').fill(cuenta.password);
      if (o.esMedico ?? true) await page.getByLabel(/Soy médico/).check();
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
    },
    // Si el acceso automático tras el registro choca con el límite de Better Auth, el sitio manda a /login.
    titulo(page, 'Protege tu cuenta').or(titulo(page, 'Iniciar sesión').first()),
  );
  if (new URL(page.url()).pathname === '/login') await iniciarSesion(page, cuenta, titulo(page, 'Protege tu cuenta'));

  cuenta.secreto = await activarMfa(page, cuenta.password);
  await expect(tituloAgenda(page)).toBeVisible();
  return cuenta;
}

/** Pantalla de configurar MFA ya abierta: pide la contraseña, lee la clave, confirma con un código y llega a la agenda. */
export async function activarMfa(page: Page, password: string): Promise<string> {
  const clave = page.getByText(/¿No puedes escanear\?/).locator('code');
  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Contraseña').fill(password);
      await page.getByRole('button', { name: 'Generar código QR' }).click();
    },
    clave,
  );
  const secreto = (await clave.textContent())?.trim() ?? '';
  expect(secreto).toMatch(/^[A-Z2-7]+$/);

  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Código de verificación').fill(await codigoTotp(secreto));
      await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
    },
    tituloAgenda(page),
  );
  return secreto;
}

/** Inicia sesión con correo y contraseña; `listo` es lo que debe verse al terminar (agenda, cambio de contraseña, MFA…). */
export async function iniciarSesion(page: Page, cuenta: { email: string; password: string }, listo: Locator): Promise<void> {
  await page.goto('/login');
  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Correo electrónico').fill(cuenta.email);
      await page.getByLabel('Contraseña').fill(cuenta.password);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    },
    listo,
  );
}

/** Segundo paso del acceso con MFA: escribe el código TOTP vigente. */
export async function verificarTotp(page: Page, secreto: string, listo: Locator): Promise<void> {
  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Código de verificación').fill(await codigoTotp(secreto));
      await page.getByRole('button', { name: 'Verificar' }).click();
    },
    listo,
  );
}

/** Pantalla "Cambia tu contraseña" ya abierta: la cambia y llega a `listo`. */
export async function cambiarPasswordTemporal(page: Page, actual: string, nueva: string, listo: Locator): Promise<void> {
  await enviarRespetandoLimite(
    page,
    async () => {
      await page.getByLabel('Contraseña actual').fill(actual);
      await page.getByLabel('Contraseña nueva', { exact: true }).fill(nueva);
      await page.getByLabel('Confirma la contraseña nueva').fill(nueva);
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    },
    listo,
  );
}

export const encabezadoAgenda = tituloAgenda;

/** Título de las tarjetas de entrada (CardTitle es un div, no un encabezado). */
export const titulo = (page: Page, texto: string): Locator => page.getByText(texto, { exact: true });

/**
 * Horario de lunes a domingo (08:00–20:00) y un tipo de cita en la ficha del médico. Con jornada todos los días,
 * cualquier fecha futura sirve y las pruebas no dependen del día de la semana en que se ejecuten.
 */
export async function configurarHorarioYTipo(page: Page, nombreMedico: string, tipo = { nombre: 'Consulta general', duracion: 30 }): Promise<void> {
  await page.goto('/medicos');
  await page.getByRole('link', { name: nombreMedico }).click();
  await expect(page.getByRole('heading', { name: nombreMedico, level: 1 })).toBeVisible();

  for (const dia of DIAS_SEMANA) {
    const grupo = page.getByRole('group', { name: dia });
    await grupo.getByRole('button', { name: 'Agregar bloque' }).click();
    await grupo.getByLabel(`Inicio ${dia}`).fill('08:00');
    await grupo.getByLabel(`Fin ${dia}`).fill('20:00');
  }
  await page.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Horario guardado' })).toBeVisible();

  await page.getByRole('tab', { name: 'Tipos de cita' }).click();
  await page.getByLabel('Nombre del tipo').fill(tipo.nombre);
  await page.getByLabel('Duración (min)').fill(String(tipo.duracion));
  await page.getByRole('button', { name: 'Agregar tipo' }).click();
  await expect(page.getByLabel(`Nombre de ${tipo.nombre}`)).toBeVisible();
}

/**
 * Agenda una cita desde el formulario eligiendo el hueco número `indiceHueco` (0 = el primero) de `fecha`.
 * Devuelve la hora que mostró ese hueco (HH:mm en la zona del consultorio).
 */
export async function agendarCita(page: Page, o: { fecha: string; paciente: string; indiceHueco?: number }): Promise<string> {
  await page.goto('/agenda');
  await page.getByRole('button', { name: 'Nueva cita' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Nueva cita' });

  const medico = dialogo.getByLabel('Médico');
  if ((await medico.inputValue()) === '') await medico.selectOption({ index: 1 });
  await dialogo.getByLabel('Tipo de cita').selectOption({ index: 1 });
  await dialogo.getByLabel('Fecha').fill(o.fecha);

  const huecos = dialogo.locator('label:has(input[type=radio])');
  const indice = o.indiceHueco ?? 0;
  await expect(huecos.nth(indice)).toBeVisible();
  const hora = ((await huecos.nth(indice).textContent()) ?? '').trim();
  expect(hora).toMatch(/^\d{2}:\d{2}$/);
  await huecos.nth(indice).click();

  await dialogo.getByLabel('Nombre del paciente').fill(o.paciente);
  await dialogo.getByLabel('Teléfono').fill('5512345678');
  await dialogo.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dialogo).toBeHidden();
  return hora;
}

/** Cambia el calendario a la vista semanal y avanza hasta que se vea `fecha` (`YYYY-MM-DD`). */
export async function irASemanaDe(page: Page, fecha: string): Promise<void> {
  await page.locator('.fc-timeGridWeek-button').click();
  const columna = page.locator(`.fc-col-header-cell[data-date="${fecha}"]`);
  for (let i = 0; i < 4 && !(await columna.isVisible()); i++) await page.locator('.fc-next-button').click();
  await expect(columna).toBeVisible();
}

export const eventoDe = (page: Page, paciente: string): Locator => page.locator('.fc-event', { hasText: paciente });

/** Arrastra un evento del calendario (vista semanal) hasta la franja de las `hora` (HH:mm) del mismo día. */
export async function arrastrarEventoA(page: Page, evento: Locator, hora: string): Promise<void> {
  const franja = page.locator(`.fc-timegrid-slot-lane[data-time="${hora}:00"]`);
  await franja.scrollIntoViewIfNeeded();
  const origen = await evento.boundingBox();
  const destino = await franja.boundingBox();
  if (!origen || !destino) throw new Error('no se pudo medir el evento o la franja de destino');
  const x = origen.x + origen.width / 2;
  const y0 = origen.y + 6;
  const y1 = destino.y + 6;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.mouse.move(x, y0 + 12, { steps: 3 });
  await page.mouse.move(x, y1, { steps: 20 });
  await page.mouse.up();
}

/** Alta de una persona del equipo con contraseña temporal (pantalla Equipo, solo administración). */
export async function altaMiembro(
  page: Page,
  o: { nombre: string; email: string; rol: 'recepcion' | 'medico'; passwordTemporal: string },
): Promise<void> {
  await page.goto('/equipo');
  const formulario = page.getByRole('form', { name: 'Agregar persona al equipo' });
  await formulario.getByLabel('Nombre', { exact: true }).fill(o.nombre);
  await formulario.getByLabel('Correo', { exact: true }).fill(o.email);
  await formulario.getByLabel('Rol', { exact: true }).selectOption(o.rol);
  await formulario.getByLabel('Contraseña temporal', { exact: true }).fill(o.passwordTemporal);
  await formulario.getByRole('button', { name: 'Agregar al equipo' }).click();
  await expect(formulario.getByRole('status')).toContainText(o.passwordTemporal);
}

/** FullCalendar escribe la hora sin cero inicial ("9:00 - 9:30"); el formulario la muestra como "09:00". */
export const horaDelCalendario = (hora: string): RegExp => new RegExp(`^${hora.replace(/^0/, '')} - `);
