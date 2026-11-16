import { beforeEach, describe, expect, test, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn<(opciones: unknown) => { sendMail: typeof sendMail }>(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { crearCanalSmtp } = await import('../../src/correo/smtp.js');

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({});
  createTransport.mockClear();
});

describe('crearCanalSmtp', () => {
  test('sin usuario no autentica; envía remitente, destino, cuerpos y el adjunto en línea', async () => {
    const canal = crearCanalSmtp({ host: 'mailpit', puerto: 1025, remitente: 'C <c@x.test>' });
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ host: 'mailpit', port: 1025, secure: false });
    expect(createTransport.mock.calls[0]?.[0]).not.toHaveProperty('auth');
    await canal.enviar({ para: 'p@x.test', asunto: 'A', html: '<p>h</p>', texto: 't', adjuntos: [{ cid: 'logo', contenido: new Uint8Array([1, 2]), tipo: 'image/png' }] });
    const m = sendMail.mock.calls[0]?.[0];
    expect(m).toMatchObject({ from: 'C <c@x.test>', to: 'p@x.test', subject: 'A', html: '<p>h</p>', text: 't' });
    expect(m.attachments).toEqual([{ cid: 'logo', content: Buffer.from([1, 2]), contentType: 'image/png', filename: 'logo.png', contentDisposition: 'inline' }]);
  });

  test('con usuario autentica; el puerto 465 usa TLS implícito; sin adjuntos manda lista vacía', async () => {
    const canal = crearCanalSmtp({ host: 'smtp.x.test', puerto: 465, usuario: 'u', password: 'p', remitente: 'c@x.test' });
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ secure: true, auth: { user: 'u', pass: 'p' } });
    expect(createTransport.mock.calls[0]?.[0]).not.toHaveProperty('requireTLS');
    await canal.enviar({ para: 'p@x.test', asunto: 'A', html: 'h', texto: 't' });
    expect(sendMail.mock.calls[0]?.[0].attachments).toEqual([]);
  });

  test('con credenciales y puerto distinto de 465 exige STARTTLS; sin credenciales no', () => {
    crearCanalSmtp({ host: 'smtp.x.test', puerto: 587, usuario: 'u', password: 'p', remitente: 'c@x.test' });
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ secure: false, requireTLS: true });
    crearCanalSmtp({ host: 'mailpit', puerto: 1025, remitente: 'c@x.test' });
    expect(createTransport.mock.calls[1]?.[0]).not.toHaveProperty('requireTLS');
  });

  test('un fallo del transporte se propaga', async () => {
    sendMail.mockRejectedValue(new Error('caído'));
    await expect(crearCanalSmtp({ host: 'h', puerto: 25, remitente: 'c@x.test' }).enviar({ para: 'p@x.test', asunto: 'A', html: 'h', texto: 't' })).rejects.toThrow('caído');
  });
});
