import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { crearClienteAgenda } from '../../src/externos/agenda.js';
import { crearClienteIdentidad } from '../../src/externos/identidad.js';

const TOKEN = 'token-interno-de-pruebas-'.repeat(2);
const T = '0198a3a6-0000-7000-8000-000000000001';
const consultorio = { nombreMostrado: 'C', telefono: null, colorPrimario: null, colorTexto: null, logoKey: null, zonaHoraria: 'America/Mexico_City', pais: 'MX' };
const cita = {
  citaId: '0198a3a6-0000-7000-8000-000000000002',
  version: 1,
  inicio: '2031-05-02T17:30:00.000Z',
  fin: '2031-05-02T18:00:00.000Z',
  estado: 'agendada',
  pideCambio: false,
  medicoId: '0198a3a6-0000-7000-8000-000000000003',
  medicoNombre: 'Dra. Pérez',
  tipoCitaNombre: 'Consulta',
  contacto: { nombre: 'Ana', telefono: '+525512345678', email: null },
};

let servidor: Server;
let base: string;
const peticiones: { url: string; token: string | undefined }[] = [];

beforeAll(async () => {
  servidor = createServer((req, res) => {
    peticiones.push({ url: req.url ?? '', token: req.headers['x-token-interno'] as string | undefined });
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/interno/citas-para-recordatorio')) res.end(JSON.stringify({ citas: [cita] }));
    else if (req.url?.startsWith('/interno/consultorio-para-mensaje')) res.end(JSON.stringify(consultorio));
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

describe('clientes internos', () => {
  test('agenda: pide las citas con tenantId y rango, envía el token interno y devuelve la lista validada', async () => {
    const citas = await crearClienteAgenda(base, TOKEN).obtenerCitas(T, '2031-05-02', '2031-05-03');
    expect(citas).toEqual([cita]);
    const p = peticiones.at(-1)!;
    expect(p.token).toBe(TOKEN);
    expect(new URL(p.url, 'http://x').searchParams.toString()).toBe(`tenantId=${T}&desde=2031-05-02&hasta=2031-05-03`);
  });

  test('identidad: devuelve el consultorio validado', async () => {
    expect(await crearClienteIdentidad(base, TOKEN).obtenerConsultorio(T)).toEqual(consultorio);
    expect(peticiones.at(-1)?.url).toBe(`/interno/consultorio-para-mensaje?tenantId=${T}`);
  });

  test('una respuesta que no es 200 falla (el llamador decide reintentar)', async () => {
    await expect(crearClienteAgenda(`${base}otra`, TOKEN).obtenerCitas(T, '2031-05-02', '2031-05-02')).rejects.toThrow(/404/);
  });
});
