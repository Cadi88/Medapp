// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { exito, fallo } from '@/lib/api/resultado';
import { CITA_A } from './apoyo';

const m = vi.hoisted(() => ({ llamarGateway: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '9.9.9.9' }) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (d: string) => {
    throw new Error(`REDIRECT:${d}`);
  },
}));
vi.mock('@/lib/api/gateway', () => ({ llamarGateway: m.llamarGateway, ipDelCliente: (h: Headers) => h.get('x-forwarded-for') ?? undefined }));

const acciones = await import('@/features/recordatorios/actions');

const BASE = '/api/notificaciones/recordatorios';
const error = (code: string, message = 'x') => ({ code, message }) as never;

beforeEach(() => vi.clearAllMocks());

describe('aprobarRecordatorio', () => {
  test('aprueba la cita y refresca la pantalla', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, estado: 'enviado', envio: 'enviado' }));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(`${BASE}/${CITA_A}/aprobar`, expect.objectContaining({ metodo: 'POST', auth: 'token' }));
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
  });

  test('si el envío de esa llamada falló, avisa "No se pudo enviar" y refresca; si no se intentó o salió, es éxito', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, estado: 'aprobado', envio: 'fallido' }));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ mensaje: 'No se pudo enviar' });
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, estado: 'aprobado', envio: 'no_intentado' }));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ ok: true });
  });

  test('un id que no es uuid no llega al gateway', async () => {
    expect(await acciones.aprobarRecordatorio('../x')).toEqual({ mensaje: 'Revisa los datos del formulario' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });

  test('un error del servicio se muestra y la pantalla se refresca igual', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(404, error('NO_ENCONTRADO', 'Recordatorio no encontrado')));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ mensaje: 'Recordatorio no encontrado' });
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
  });

  test('sesión vencida desvía al login', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(401, error('NO_AUTENTICADO')));
    await expect(acciones.aprobarRecordatorio(CITA_A)).rejects.toThrow('REDIRECT:/login');
  });

  test('un error interno da el aviso genérico, sin detalles', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(500, error('INTERNO', 'stack secreto')));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
  });

  test('429 pide esperar', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(429, error('DEMASIADAS_SOLICITUDES')));
    expect(await acciones.aprobarRecordatorio(CITA_A)).toEqual({ mensaje: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
  });
});

describe('aprobarTodos', () => {
  test('envía el rango como lo mostró la pantalla', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ aprobados: 2, enviados: 2, fallidos: 0 }));
    expect(await acciones.aprobarTodos('2026-11-16', '2026-11-18')).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(`${BASE}/aprobar`, expect.objectContaining({ cuerpo: { desde: '2026-11-16', hasta: '2026-11-18' } }));
  });

  test('con envíos fallidos avisa "No se pudo enviar" (con cuántos si son varios) y refresca', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ aprobados: 2, enviados: 1, fallidos: 1 }));
    expect(await acciones.aprobarTodos('2026-11-16', '2026-11-18')).toEqual({ mensaje: 'No se pudo enviar' });
    m.llamarGateway.mockResolvedValueOnce(exito({ aprobados: 3, enviados: 0, fallidos: 3 }));
    expect(await acciones.aprobarTodos('2026-11-16', '2026-11-18')).toEqual({ mensaje: 'No se pudo enviar 3 correos' });
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
  });

  test('un rango inválido no llega al gateway', async () => {
    expect(await acciones.aprobarTodos('ayer', '2026-11-18')).toEqual({ mensaje: 'Revisa los datos del formulario' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});

describe('reintentarEnvio', () => {
  test('muestra el mensaje en español del 409 (la cita ya empezó)', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(409, error('CONFLICTO', 'La cita ya empezó; no se puede reenviar el recordatorio')));
    expect(await acciones.reintentarEnvio(CITA_A)).toEqual({ mensaje: 'La cita ya empezó; no se puede reenviar el recordatorio' });
    expect(m.llamarGateway).toHaveBeenCalledWith(`${BASE}/${CITA_A}/reintentar`, expect.objectContaining({ metodo: 'POST' }));
  });

  test('éxito', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, estado: 'enviado', envio: 'enviado' }));
    expect(await acciones.reintentarEnvio(CITA_A)).toEqual({ ok: true });
  });

  test('si el reenvío falló otra vez, avisa "No se pudo enviar"', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, estado: 'aprobado', envio: 'fallido' }));
    expect(await acciones.reintentarEnvio(CITA_A)).toEqual({ mensaje: 'No se pudo enviar' });
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
  });
});

describe('abrirWhatsApp', () => {
  test('manda la fecha local y devuelve el enlace de wa.me', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ enlace: 'https://wa.me/525512345678?text=Hola' }));
    expect(await acciones.abrirWhatsApp(CITA_A, '2026-11-16')).toEqual({ ok: true, enlace: 'https://wa.me/525512345678?text=Hola' });
    expect(m.llamarGateway).toHaveBeenCalledWith(`${BASE}/${CITA_A}/whatsapp`, expect.objectContaining({ cuerpo: { fecha: '2026-11-16' } }));
    expect(m.revalidatePath).toHaveBeenCalledWith('/recordatorios');
  });

  test('un enlace que no es de wa.me no se entrega al navegador', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ enlace: 'https://malo.example/x' }));
    expect(await acciones.abrirWhatsApp(CITA_A, '2026-11-16')).toEqual({ mensaje: 'Ocurrió un error. Intenta de nuevo.' });
  });

  test('teléfono no válido: el mensaje del servicio', async () => {
    m.llamarGateway.mockResolvedValueOnce(fallo(400, error('VALIDACION', 'Teléfono no válido para WhatsApp')));
    expect(await acciones.abrirWhatsApp(CITA_A, '2026-11-16')).toEqual({ mensaje: 'Teléfono no válido para WhatsApp' });
  });

  test('una fecha mal formada no llega al gateway', async () => {
    expect(await acciones.abrirWhatsApp(CITA_A, '16/11')).toEqual({ mensaje: 'Revisa los datos del formulario' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});

describe('registrarRespuestaRecepcion', () => {
  test('envía fecha y respuesta', async () => {
    m.llamarGateway.mockResolvedValueOnce(exito({ citaId: CITA_A, respuesta: 'cancela' }));
    expect(await acciones.registrarRespuestaRecepcion(CITA_A, '2026-11-16', 'cancela')).toEqual({ ok: true });
    expect(m.llamarGateway).toHaveBeenCalledWith(
      `${BASE}/${CITA_A}/respuesta`,
      expect.objectContaining({ cuerpo: { fecha: '2026-11-16', respuesta: 'cancela' } }),
    );
  });

  test('una respuesta desconocida no llega al gateway', async () => {
    expect(await acciones.registrarRespuestaRecepcion(CITA_A, '2026-11-16', 'quizas')).toEqual({ mensaje: 'Revisa los datos del formulario' });
    expect(m.llamarGateway).not.toHaveBeenCalled();
  });
});
