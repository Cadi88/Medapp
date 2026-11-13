import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import { crearConsultorio, peticion, peticionBinaria, slugUnico, tokenDeRecepcion } from './cliente.js';

const LOGO = readFileSync(fileURLToPath(new URL('../../e2e-web/test/fixtures/logo.png', import.meta.url)));
const PNG = { bytes: LOGO, tipo: 'image/png' };
const FIRMA_PNG = '89504e47';

interface Consultorio {
  nombreComercial: string | null;
  direccion: string | null;
  telefono: string | null;
  colorPrimario: string | null;
  logoVersion: number;
}
interface Evento {
  accion: string;
  detalle: { campos?: string[] } | null;
}

describe('Personalización del consultorio de punta a punta (a través del gateway)', () => {
  test('el admin personaliza, sube, reemplaza y quita el logo; queda en la bitácora; recepción recibe 403', async () => {
    const slug = slugUnico('e2e-pers');
    const { tenantId, token } = await crearConsultorio(slug);

    const personalizado = await peticion<Consultorio>('PATCH', '/api/identidad/consultorio/personalizacion', {
      token,
      cuerpo: { nombreComercial: 'Clínica Sol', direccion: 'Av. Reforma 123', telefono: '55 1234 5678', colorPrimario: '#0f766e' },
    });
    expect(personalizado.status).toBe(200);
    expect(personalizado.cuerpo).toMatchObject({ nombreComercial: 'Clínica Sol', telefono: '+525512345678', colorPrimario: '#0f766e', logoVersion: 0 });

    const sinLogo = await peticionBinaria('GET', '/api/identidad/consultorio/logo', { token });
    expect(sinLogo.status).toBe(404);

    const subido = await peticionBinaria('PUT', '/api/identidad/consultorio/logo', { token, archivo: PNG });
    expect(subido.status).toBe(200);
    expect(JSON.parse(subido.bytes.toString())).toEqual({ logoVersion: 1 });

    const leido = await peticionBinaria('GET', '/api/identidad/consultorio/logo', { token });
    expect(leido.status).toBe(200);
    expect(leido.tipo).toBe('image/png');
    expect(leido.bytes.subarray(0, 4).toString('hex')).toBe(FIRMA_PNG);

    const reemplazado = await peticionBinaria('PUT', '/api/identidad/consultorio/logo', { token, archivo: PNG });
    expect(JSON.parse(reemplazado.bytes.toString())).toEqual({ logoVersion: 2 });
    const actual = await peticion<Consultorio>('GET', '/api/identidad/consultorio', { token });
    expect(actual.cuerpo).toMatchObject({ telefono: '+525512345678', logoVersion: 2 });

    const noImagen = await peticionBinaria('PUT', '/api/identidad/consultorio/logo', { token, archivo: { bytes: Buffer.from('no soy una imagen'), tipo: 'image/png' } });
    expect(noImagen.status).toBe(400);

    // Recepción puede ver el logo (lo muestra el encabezado) pero no cambiar nada.
    const recepcion = await tokenDeRecepcion(token, tenantId, slug);
    expect((await peticionBinaria('GET', '/api/identidad/consultorio/logo', { token: recepcion })).status).toBe(200);
    expect((await peticionBinaria('PUT', '/api/identidad/consultorio/logo', { token: recepcion, archivo: PNG })).status).toBe(403);
    expect((await peticionBinaria('DELETE', '/api/identidad/consultorio/logo', { token: recepcion })).status).toBe(403);
    const prohibido = await peticion('PATCH', '/api/identidad/consultorio/personalizacion', { token: recepcion, cuerpo: { nombreComercial: 'Otro' } });
    expect(prohibido.status).toBe(403);

    const quitado = await peticionBinaria('DELETE', '/api/identidad/consultorio/logo', { token });
    expect(quitado.status).toBe(204);
    expect((await peticionBinaria('GET', '/api/identidad/consultorio/logo', { token })).status).toBe(404);

    // Bitácora: una entrada por cambio, con los campos modificados y sin datos del consultorio.
    const eventos = await vi.waitFor(
      async () => {
        const r = await peticion<{ eventos: Evento[] }>('GET', '/api/auditoria/eventos?accion=consultorio.actualizado', { token });
        expect(r.status).toBe(200);
        expect(r.cuerpo.eventos.length).toBeGreaterThanOrEqual(4); // personalización + subir + reemplazar + quitar
        return r.cuerpo.eventos;
      },
      { timeout: 20_000, interval: 500 },
    );
    const campos = eventos.map((e) => e.detalle?.campos ?? []);
    expect(campos).toContainEqual(expect.arrayContaining(['nombreComercial', 'direccion', 'telefono', 'colorPrimario']));
    expect(campos.filter((c) => c.length === 1 && c[0] === 'logo')).toHaveLength(3);
    expect(JSON.stringify(eventos)).not.toMatch(/Clínica Sol|Reforma|5512345678/);
  });
});
