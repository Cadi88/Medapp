import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { crearConsultorio, peticion, slugUnico } from './cliente.js';

/** Buzón de Mailpit (compose lo publica en 8025); el SMTP (1025) solo existe en la red interna. */
const MAILPIT = (process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025').replace(/\/$/, '');
const ZONA = 'America/Mexico_City';
const TODA_LA_SEMANA = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: '09:00', horaFin: '17:00' }));

/** Fecha local de mañana en la zona del consultorio (`YYYY-MM-DD`). */
function mananaLocal(): string {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface Cita {
  id: string;
  inicio: string;
  estado: string;
}
interface Recordatorios {
  modo: string;
  horaEnvio: string;
  citas: { citaId: string; correo: { estado: string; sinAprobarYVencido: boolean }; respuesta: { valor: string; origen: string } | null }[];
}

async function correoPara(email: string): Promise<{ texto: string; html: string }> {
  return vi.waitFor(
    async () => {
      const lista = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      expect(lista.status).toBe(200);
      const { messages } = (await lista.json()) as { messages: { ID: string }[] };
      expect(messages).toHaveLength(1);
      const m = await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
      const cuerpo = (await m.json()) as { Text: string; HTML: string };
      return { texto: cuerpo.Text, html: cuerpo.HTML };
    },
    { timeout: 30_000, interval: 500 },
  );
}

describe('Recordatorios de punta a punta (a través del gateway y Mailpit)', () => {
  test('flujo completo: aprobar → correo en Mailpit → confirmar → cita confirmada', async () => {
    const { token } = await crearConsultorio(slugUnico('e2e-recordatorios'));
    const medicoId = await vi.waitFor(
      async () => {
        const r = await peticion<{ medicos: { usuarioId: string }[] }>('GET', '/api/agenda/medicos', { token });
        expect(r.cuerpo.medicos).toHaveLength(1);
        return r.cuerpo.medicos[0]!.usuarioId;
      },
      { timeout: 20_000, interval: 500 },
    );
    const tipo = await peticion<{ id: string }>('POST', `/api/agenda/medicos/${medicoId}/tipos-cita`, { token, cuerpo: { nombre: 'Consulta general', duracionMin: 30 } });
    expect(tipo.status).toBe(201);
    expect((await peticion('PUT', `/api/agenda/medicos/${medicoId}/horario`, { token, cuerpo: { bloques: TODA_LA_SEMANA } })).status).toBe(200);

    // Hora de envío a medianoche: ya pasó hoy, así que aprobar un recordatorio de mañana lo envía en ese momento.
    const config = await peticion<{ horaEnvio: string; modo: string }>('PUT', '/api/notificaciones/config', { token, cuerpo: { horaEnvio: '00:00' } });
    expect(config.status).toBe(200);
    expect(config.cuerpo).toMatchObject({ horaEnvio: '00:00', modo: 'con_revision' });

    const manana = mananaLocal();
    const disp = await peticion<{ huecos: string[] }>('GET', `/api/agenda/medicos/${medicoId}/disponibilidad?fecha=${manana}&tipoCitaId=${tipo.cuerpo.id}`, { token });
    expect(disp.cuerpo.huecos.length).toBeGreaterThan(0);
    const email = `paciente-${randomUUID().slice(0, 8)}@e2e.test`;
    const cita = await peticion<Cita>('POST', '/api/agenda/citas', {
      token,
      cuerpo: { medicoId, tipoCitaId: tipo.cuerpo.id, inicio: disp.cuerpo.huecos[0], contacto: { nombre: 'Paciente E2E', telefono: '5512345678', email } },
    });
    expect(cita.status).toBe(201);

    const lista = await peticion<Recordatorios>('GET', `/api/notificaciones/recordatorios?desde=${manana}&hasta=${manana}`, { token });
    expect(lista.status).toBe(200);
    expect(lista.cuerpo).toMatchObject({ modo: 'con_revision', horaEnvio: '00:00' });
    const fila = lista.cuerpo.citas.find((c) => c.citaId === cita.cuerpo.id);
    expect(fila?.correo).toMatchObject({ estado: 'pendiente', sinAprobarYVencido: true });

    const aprobada = await peticion<{ estado: string }>('POST', `/api/notificaciones/recordatorios/${cita.cuerpo.id}/aprobar`, { token });
    expect(aprobada.status).toBe(200);
    expect(aprobada.cuerpo.estado).toBe('enviado');

    const correo = await correoPara(email);
    const enlace = /\/r\/([A-Za-z0-9_-]{43})/.exec(correo.texto) ?? /\/r\/([A-Za-z0-9_-]{43})/.exec(correo.html);
    expect(enlace).not.toBeNull();
    const tokenPaciente = enlace![1]!;

    // La página pública no pide sesión y no trae datos de contacto del paciente.
    const pagina = await peticion<{ estado: string; hora?: string }>('GET', `/api/notificaciones/respuestas/${tokenPaciente}`);
    expect(pagina.status).toBe(200);
    expect(pagina.cuerpo.estado).toBe('vigente');
    expect(JSON.stringify(pagina.cuerpo)).not.toMatch(/Paciente E2E|5512345678|e2e\.test/);

    const registrada = await peticion<{ estado: string }>('POST', `/api/notificaciones/respuestas/${tokenPaciente}`, { cuerpo: { respuesta: 'confirma' } });
    expect(registrada).toMatchObject({ status: 200, cuerpo: { estado: 'registrada' } });

    // Agenda consume cita.respuesta_paciente de forma asíncrona.
    await vi.waitFor(
      async () => {
        const r = await peticion<Cita>('GET', `/api/agenda/citas/${cita.cuerpo.id}`, { token });
        expect(r.cuerpo.estado).toBe('confirmada');
      },
      { timeout: 30_000, interval: 500 },
    );

    const otra = await peticion<{ estado: string }>('POST', `/api/notificaciones/respuestas/${tokenPaciente}`, { cuerpo: { respuesta: 'cancela' } });
    expect(otra.cuerpo.estado).toBe('respondida');
    const despues = await peticion<Recordatorios>('GET', `/api/notificaciones/recordatorios?desde=${manana}&hasta=${manana}`, { token });
    expect(despues.cuerpo.citas.find((c) => c.citaId === cita.cuerpo.id)).toMatchObject({ correo: { estado: 'enviado' }, respuesta: { valor: 'confirma', origen: 'paciente' } });
  });

  test('sin token → 401 en recordatorios y config; un enlace inventado → invalida; /interno nunca llega', async () => {
    expect((await peticion('GET', '/api/notificaciones/recordatorios?desde=2030-01-01&hasta=2030-01-01')).status).toBe(401);
    expect((await peticion('GET', '/api/notificaciones/config')).status).toBe(401);
    const inventado = await peticion<{ estado: string }>('GET', `/api/notificaciones/respuestas/${'a'.repeat(43)}`);
    expect(inventado).toMatchObject({ status: 200, cuerpo: { estado: 'invalida' } });
    expect((await peticion('GET', '/api/notificaciones/interno/algo')).status).toBe(404);
  });
});
