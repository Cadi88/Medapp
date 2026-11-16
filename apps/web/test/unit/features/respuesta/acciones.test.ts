// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));

const { enviarRespuesta } = await import('@/features/respuesta/actions');
const { GET } = await import('@/app/r/[token]/logo/route');

const TOKEN = 'abc_DEF-123';
const formulario = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('enviarRespuesta', () => {
  test('POST público sin sesión con la opción elegida; devuelve el estado del servicio', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ estado: 'registrada' }));
    expect(await enviarRespuesta({}, formulario({ token: TOKEN, respuesta: 'cancela' }))).toEqual({ estado: 'registrada' });
    expect(m.llamarGateway).toHaveBeenCalledWith(
      `/api/notificaciones/respuestas/${TOKEN}`,
      expect.objectContaining({ metodo: 'POST', auth: 'ninguna', cuerpo: { respuesta: 'cancela' }, ip: '9.9.9.9' }),
    );
  });

  test.each(['respondida', 'invalida'] as const)('estado %s', async (estado) => {
    m.llamarGateway.mockResolvedValueOnce(exito({ estado }));
    expect(await enviarRespuesta({}, formulario({ token: TOKEN, respuesta: 'confirma' }))).toEqual({ estado });
  });

  test('una opción desconocida o un token con caracteres raros no llegan al gateway', async () => {
    expect(await enviarRespuesta({}, formulario({ token: TOKEN, respuesta: 'quizas' }))).toEqual({ mensaje: 'Elige una opción para responder.' });
    expect(await enviarRespuesta({}, formulario({ token: '../x?y', respuesta: 'confirma' }))).toEqual({ estado: 'invalida' });
    expect(await enviarRespuesta({}, formulario({ respuesta: 'confirma' }))).toEqual({ estado: 'invalida' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('un error del gateway da un aviso en español, sin detalles ni el token', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(503, { code: 'INTERNO', message: `fallo en ${TOKEN}` } as never));
    const r = await enviarRespuesta({}, formulario({ token: TOKEN, respuesta: 'confirma' }));
    expect(r).toEqual({ mensaje: 'No pudimos registrar tu respuesta. Intenta de nuevo.' });
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('429: pide esperar', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(429, { code: 'DEMASIADAS_SOLICITUDES', message: 'x' } as never));
    const r = await enviarRespuesta({}, formulario({ token: TOKEN, respuesta: 'confirma' }));
    expect(r).toEqual({ mensaje: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
  });
});

describe('GET /r/[token]/logo', () => {
  const llamar = (token = TOKEN) => GET(new Request('http://web/r/x/logo'), { params: Promise.resolve({ token }) });
  const PNG = new Uint8Array([137, 80, 78, 71]);

  test('reenvía bytes con content-type, caché y nosniff, sin sesión', async () => {
    m.llamarGateway.mockResolvedValue(
      exito({ bytes: PNG, tipo: 'image/png', cabeceras: new Headers({ 'cache-control': 'private, max-age=300' }) }),
    );
    const res = await llamar();
    expect(m.llamarGateway).toHaveBeenCalledWith(
      `/api/notificaciones/respuestas/${TOKEN}/logo`,
      expect.objectContaining({ auth: 'ninguna', respuestaBinaria: true }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test('un tipo que no es imagen no se reenvía tal cual', async () => {
    m.llamarGateway.mockResolvedValue(exito({ bytes: PNG, tipo: 'text/html', cabeceras: new Headers() }));
    const res = await llamar();
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  test('404 se conserva; cualquier otro fallo es 503 sin cuerpo', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, { code: 'NO_ENCONTRADO', message: 'x' } as never));
    expect((await llamar()).status).toBe(404);
    m.llamarGateway.mockResolvedValueOnce(fallo(500, { code: 'INTERNO', message: 'x' } as never));
    const res = await llamar();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  test('un token con caracteres raros ni se consulta', async () => {
    expect((await llamar('../x')).status).toBe(404);
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});

describe('tipos del logo público', () => {
  const llamar = () => GET(new Request('http://web/r/x/logo'), { params: Promise.resolve({ token: TOKEN }) });

  test.each(['image/png', 'image/jpeg', 'image/webp'])('%s se reenvía', async (tipo) => {
    m.llamarGateway.mockResolvedValue(exito({ bytes: new Uint8Array([1]), tipo, cabeceras: new Headers() }));
    expect((await llamar()).headers.get('content-type')).toBe(tipo);
  });

  test.each(['image/svg+xml', 'image/gif', 'text/html', 'image/png; charset=x'])('%s no se reenvía tal cual', async (tipo) => {
    m.llamarGateway.mockResolvedValue(exito({ bytes: new Uint8Array([1]), tipo, cabeceras: new Headers() }));
    const res = await llamar();
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
