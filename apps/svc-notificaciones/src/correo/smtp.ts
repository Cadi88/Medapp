import nodemailer from 'nodemailer';
import type { CanalCorreo } from './canal.js';

export interface ConfigSmtp {
  host: string;
  puerto: number;
  /** Sin usuario no hay autenticación (Mailpit local). */
  usuario?: string;
  password?: string;
  /** Remitente (`Nombre <correo@dominio>`). */
  remitente: string;
}

/** Canal SMTP con `nodemailer`; el transporte vive mientras viva el proceso. */
export function crearCanalSmtp(c: ConfigSmtp): CanalCorreo {
  const transporte = nodemailer.createTransport({
    host: c.host,
    port: c.puerto,
    secure: c.puerto === 465,
    ...(c.usuario ? { auth: { user: c.usuario, pass: c.password ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });
  return {
    enviar: async (m) => {
      await transporte.sendMail({
        from: c.remitente,
        to: m.para,
        subject: m.asunto,
        text: m.texto,
        html: m.html,
        attachments: (m.adjuntos ?? []).map((a) => ({ cid: a.cid, content: Buffer.from(a.contenido), contentType: a.tipo, filename: `${a.cid}.png`, contentDisposition: 'inline' as const })),
      });
    },
  };
}
