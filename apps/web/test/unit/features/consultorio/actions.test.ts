// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));

const acciones = await import('@/features/consultorio/actions');

const consultorio = {
  id: '0190a0a0-0000-7000-8000-00000000000a',
  nombre: 'Dental Sol',
  slug: 'dental-sol',
  zonaHoraria: 'America/Mexico_City',
  nombreComercial: 'Dental Sol',
  direccion: null,
  telefono: '+525512345678',
  colorPrimario: '#1d4ed8',
  colorTexto: '#ffffff',
  logoVersion: 0,
  pais: 'MX',
  moneda: 'MXN',
};
const formulario = (campos: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const error = (code: string, message = 'x', details?: unknown) => ({ code, message, details }) as never;
const llamadas = (ruta: string) => m.llamarGateway.mock.calls.filter(([r]) => r === ruta);
const RUTA = '/api/identidad/consultorio';
const archivo = (n: number, tipo = 'image/png') => new File([new Uint8Array(n)], 'logo.png', { type: tipo });

beforeEach(() => {
  m.llamarGateway.mockReset();
  m.revalidatePath.mockReset();
});

describe('guardarPersonalizacion', () => {
  const campos = { nombreComercial: 'Dental Sol', direccion: 'Calle 1', telefono: '', colorPrimario: '#0f766e' };

  const conActual = (patch = exito(consultorio)) =>
    m.llamarGateway.mockImplementation(async (ruta: string) => (ruta === RUTA ? exito(consultorio) : patch));

  test('envía solo lo modificado y vacío como null, y revalida el layout', async () => {
    conActual();
    expect(await acciones.guardarPersonalizacion({}, formulario(campos))).toEqual({ ok: true });
    const [, o] = llamadas(`${RUTA}/personalizacion`)[0] ?? [];
    expect(o).toMatchObject({
      metodo: 'PATCH',
      auth: 'token',
      cuerpo: { direccion: 'Calle 1', telefono: null, colorPrimario: '#0f766e' },
    });
    expect((o as { cuerpo: object }).cuerpo).not.toHaveProperty('nombreComercial');
    expect(m.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  test('sin cambios no llama a la API de personalización', async () => {
    conActual();
    const fd = formulario({ nombreComercial: 'Dental Sol', direccion: '', telefono: '+525512345678', colorPrimario: '#1d4ed8' });
    expect(await acciones.guardarPersonalizacion({}, fd)).toEqual({ ok: true });
    expect(llamadas(`${RUTA}/personalizacion`)).toHaveLength(0);
  });

  test('color claro o inválido se rechaza antes de llamar a la API', async () => {
    const claro = await acciones.guardarPersonalizacion({}, formulario({ ...campos, colorPrimario: '#ffff99' }));
    expect(claro.errores).toEqual({ colorPrimario: 'Elige un color más oscuro' });
    const malo = await acciones.guardarPersonalizacion({}, formulario({ ...campos, colorPrimario: 'rojo' }));
    expect(malo.errores).toEqual({ colorPrimario: 'Color inválido (usa el formato #rrggbb)' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('un error de validación de la API se muestra bajo su campo y conserva lo escrito', async () => {
    conActual(fallo(400, error('VALIDACION', 'Teléfono inválido', [{ campo: 'telefono' }])));
    const r = await acciones.guardarPersonalizacion({}, formulario({ ...campos, telefono: '123' }));
    expect(r.errores).toEqual({ telefono: 'Teléfono inválido' });
    expect(r.valores).toMatchObject({ telefono: '123' });
  });

  test('otros errores de la API van como mensaje general; si falla la lectura previa también', async () => {
    conActual(fallo(500, error('INTERNO')));
    expect((await acciones.guardarPersonalizacion({}, formulario(campos))).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
    m.llamarGateway.mockResolvedValue(fallo(503, error('INTERNO')));
    expect((await acciones.guardarPersonalizacion({}, formulario(campos))).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});

describe('subirLogo', () => {
  test('archivo de 1.5 MB → "El logo debe pesar menos de 1 MB" sin llamar al gateway', async () => {
    const r = await acciones.subirLogo({}, formulario({ logo: archivo(1_500_000) }));
    expect(r.errores).toEqual({ logo: 'El logo debe pesar menos de 1 MB' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('tipo no permitido o sin archivo → "Sube una imagen PNG, JPG o WebP"', async () => {
    const gif = await acciones.subirLogo({}, formulario({ logo: archivo(10, 'image/gif') }));
    expect(gif.errores).toEqual({ logo: 'Sube una imagen PNG, JPG o WebP' });
    const nada = await acciones.subirLogo({}, formulario({}));
    expect(nada.errores).toEqual({ logo: 'Sube una imagen PNG, JPG o WebP' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('envía los bytes crudos con su tipo y revalida el layout', async () => {
    m.llamarGateway.mockResolvedValue(exito({ logoVersion: 2 }));
    const jpg = new File([new Uint8Array([1, 2, 3])], 'logo.jpg', { type: 'image/jpeg' });
    expect(await acciones.subirLogo({}, formulario({ logo: jpg }))).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(
      `${RUTA}/logo`,
      expect.objectContaining({ metodo: 'PUT', auth: 'token', cuerpoBinario: { bytes: new Uint8Array([1, 2, 3]), tipo: 'image/jpeg' } }),
    );
    expect(m.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  test('rechazo de la API (400) usa su texto; almacenamiento caído (503) avisa; otros van al mensaje general', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(400, error('VALIDACION', 'Sube una imagen PNG, JPG o WebP')));
    expect((await acciones.subirLogo({}, formulario({ logo: archivo(10) }))).errores).toEqual({ logo: 'Sube una imagen PNG, JPG o WebP' });
    m.llamarGateway.mockResolvedValueOnce(fallo(503, error('INTERNO')));
    expect((await acciones.subirLogo({}, formulario({ logo: archivo(10) }))).mensaje).toBe('No se pudo guardar el logo ahora. Intenta de nuevo más tarde.');
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error('INTERNO')));
    expect((await acciones.subirLogo({}, formulario({ logo: archivo(10) }))).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});

describe('quitarLogo', () => {
  test('borra el logo y revalida el layout', async () => {
    m.llamarGateway.mockResolvedValue(exito(undefined));
    expect(await acciones.quitarLogo()).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(`${RUTA}/logo`, expect.objectContaining({ metodo: 'DELETE', auth: 'token' }));
    expect(m.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  test('un error se muestra como mensaje', async () => {
    m.llamarGateway.mockResolvedValue(fallo(500, error('INTERNO')));
    expect((await acciones.quitarLogo()).mensaje).toBe('Ocurrió un error. Intenta de nuevo.');
  });
});

describe('guardarPersonalizacion: longitudes y teléfono nacional', () => {
  const campos = { nombreComercial: 'Dental Sol', direccion: '', telefono: '+525512345678', colorPrimario: '#1d4ed8' };

  test('nombre comercial de 1 carácter o dirección de más de 300 se rechazan antes de llamar a la API', async () => {
    const r = await acciones.guardarPersonalizacion({}, formulario({ ...campos, nombreComercial: 'A', direccion: 'x'.repeat(301) }));
    expect(r.errores).toEqual({
      nombreComercial: 'El nombre comercial debe tener entre 2 y 120 caracteres',
      direccion: 'La dirección no puede pasar de 300 caracteres',
    });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('el teléfono escrito solo con dígitos nacionales no cuenta como cambio si es el mismo número', async () => {
    m.llamarGateway.mockImplementation(async () => exito(consultorio));
    const r = await acciones.guardarPersonalizacion({}, formulario({ ...campos, telefono: '55 1234 5678' }));
    expect(r).toEqual({ ok: true });
    expect(llamadas(`${RUTA}/personalizacion`)).toHaveLength(0);
  });
});
