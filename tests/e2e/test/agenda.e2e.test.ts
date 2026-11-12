import { describe, expect, test, vi } from 'vitest';
import { crearConsultorio, peticion, slugUnico } from './cliente.js';

interface Evento {
  accion: string;
  /** Datos del evento tal como los publicó el servicio (contrato v1, spec §3.5). */
  detalle: Record<string, unknown> | null;
}
interface Cita {
  id: string;
  inicio: string;
  estado: string;
  version: number;
}

/** Primer lunes que cae al menos 7 días después de hoy (UTC), como YYYY-MM-DD. */
function proximoLunes(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const TODA_LA_SEMANA = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio: '09:00', horaFin: '17:00' }));

describe('Agenda de punta a punta (a través del gateway)', () => {
  test('flujo de agenda de punta a punta y auditoría', async () => {
    const { token } = await crearConsultorio(slugUnico('e2e-agenda'));

    // El médico llega a agenda de forma asíncrona (usuario.vinculado desde identidad).
    const medicoId = await vi.waitFor(
      async () => {
        const r = await peticion<{ medicos: { usuarioId: string }[] }>('GET', '/api/agenda/medicos', { token });
        expect(r.status).toBe(200);
        expect(r.cuerpo.medicos).toHaveLength(1);
        return r.cuerpo.medicos[0]!.usuarioId;
      },
      { timeout: 20_000, interval: 500 },
    );

    const tipo = await peticion<{ id: string }>('POST', `/api/agenda/medicos/${medicoId}/tipos-cita`, {
      token,
      cuerpo: { nombre: 'Consulta general', duracionMin: 30 },
    });
    expect(tipo.status).toBe(201);

    const horario = await peticion('PUT', `/api/agenda/medicos/${medicoId}/horario`, { token, cuerpo: { bloques: TODA_LA_SEMANA } });
    expect(horario.status).toBe(200);

    const fecha = proximoLunes();
    const disp = await peticion<{ huecos: string[] }>('GET', `/api/agenda/medicos/${medicoId}/disponibilidad?fecha=${fecha}&tipoCitaId=${tipo.cuerpo.id}`, { token });
    expect(disp.status).toBe(200);
    expect(disp.cuerpo.huecos.length).toBeGreaterThan(2);
    const [primero, segundo] = disp.cuerpo.huecos as [string, string];

    const creada = await peticion<Cita>('POST', '/api/agenda/citas', {
      token,
      cuerpo: { medicoId, tipoCitaId: tipo.cuerpo.id, inicio: primero, contacto: { nombre: 'Paciente E2E', telefono: '5512345678' } },
    });
    expect(creada.status).toBe(201);
    expect(creada.cuerpo.estado).toBe('agendada');

    // Ya ocupado: no aparece entre los huecos libres.
    const despues = await peticion<{ huecos: string[] }>('GET', `/api/agenda/medicos/${medicoId}/disponibilidad?fecha=${fecha}&tipoCitaId=${tipo.cuerpo.id}`, { token });
    expect(despues.cuerpo.huecos).not.toContain(primero);

    const movida = await peticion<Cita>('PATCH', `/api/agenda/citas/${creada.cuerpo.id}`, {
      token,
      cuerpo: { version: creada.cuerpo.version, inicio: segundo },
    });
    expect(movida.status).toBe(200);
    expect(movida.cuerpo.version).toBe(creada.cuerpo.version + 1);

    const cancelada = await peticion<Cita>('POST', `/api/agenda/citas/${creada.cuerpo.id}/estado`, {
      token,
      cuerpo: { version: movida.cuerpo.version, estado: 'cancelada' },
    });
    expect(cancelada.status).toBe(200);
    expect(cancelada.cuerpo.estado).toBe('cancelada');

    await vi.waitFor(
      async () => {
        const r = await peticion<{ eventos: Evento[] }>('GET', '/api/auditoria/eventos', { token });
        expect(r.status).toBe(200);
        expect(r.cuerpo.eventos.map((e) => e.accion)).toEqual(expect.arrayContaining(['cita.creada', 'cita.reprogramada', 'cita.cancelada']));
        return r.cuerpo.eventos;
      },
      { timeout: 20_000, interval: 500 },
    ).then((eventos) => {
      const detalle = (accion: string) => eventos.find((e) => e.accion === accion)?.detalle;
      const citaId = creada.cuerpo.id;
      expect(detalle('cita.creada')).toMatchObject({ citaId, medicoId, tipoCitaId: tipo.cuerpo.id, estado: 'agendada', origen: 'recepcion', fueraDeHorario: false });
      expect(detalle('cita.reprogramada')).toMatchObject({ citaId, medicoId, inicio: movida.cuerpo.inicio, anterior: { medicoId, inicio: creada.cuerpo.inicio } });
      expect(detalle('cita.cancelada')).toMatchObject({ citaId, medicoId, inicio: movida.cuerpo.inicio });
      // Ningún evento lleva datos de contacto del paciente.
      expect(JSON.stringify(eventos)).not.toMatch(/Paciente E2E|5512345678/);
    });
  });

  test('sin token → 401 en /api/agenda/citas', async () => {
    const r = await peticion('GET', '/api/agenda/citas');
    expect(r.status).toBe(401);
  });
});
