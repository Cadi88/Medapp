import type { ConsultorioParaMensaje } from '@consultorio/contracts';
import { escaparHtml, rellenar, type DatosPlantilla, type Plantillas } from '../dominio/plantillas.js';
import type { AdjuntoEnLinea } from './canal.js';

export interface EnlacesRespuesta {
  confirmar: string;
  cancelar: string;
  cambiar: string;
}

export interface EntradaCorreo {
  plantillas: Plantillas;
  datos: DatosPlantilla;
  consultorio: ConsultorioParaMensaje;
  /** PNG del logo (el almacén solo guarda PNG normalizados). */
  logo?: Uint8Array;
  enlaces: EnlacesRespuesta;
}

export interface CorreoArmado {
  asunto: string;
  html: string;
  texto: string;
  adjuntos: AdjuntoEnLinea[];
}

const COLOR_PRIMARIO_POR_OMISION = '#0f766e';
const COLOR_TEXTO_POR_OMISION = '#ffffff';
const HEX = /^#[0-9a-f]{6}$/;
const color = (valor: string | null, porOmision: string): string => (valor !== null && HEX.test(valor) ? valor : porOmision);

const BOTONES: { clave: keyof EnlacesRespuesta; etiqueta: string }[] = [
  { clave: 'confirmar', etiqueta: 'Confirmar' },
  { clave: 'cancelar', etiqueta: 'Cancelar' },
  { clave: 'cambiar', etiqueta: 'Pedir cambio' },
];

/** Arma el correo: asunto y texto en texto plano, HTML escapado, encabezado de color, logo por `cid:logo` y tres botones. */
export function armarCorreo(i: EntradaCorreo): CorreoArmado {
  const fondo = color(i.consultorio.colorPrimario, COLOR_PRIMARIO_POR_OMISION);
  const texto = color(i.consultorio.colorTexto, COLOR_TEXTO_POR_OMISION);
  const cuerpoHtml = rellenar(i.plantillas.correoCuerpo, i.datos, { html: true }).replace(/\r?\n/g, '<br>');
  const cuerpoTexto = rellenar(i.plantillas.correoCuerpo, i.datos, { html: false });
  const logoHtml = i.logo ? '<img src="cid:logo" alt="" height="40" style="height:40px;vertical-align:middle;margin-right:12px">' : '';
  const botones = BOTONES.map(
    (b) =>
      `<a href="${escaparHtml(i.enlaces[b.clave])}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:6px;background-color:${fondo};color:${texto};text-decoration:none;font-weight:bold">${b.etiqueta}</a>`,
  ).join('');
  const html =
    `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden">` +
    `<tr><td style="background-color:${fondo};color:${texto};padding:20px 24px;font-size:20px;font-weight:bold">${logoHtml}${escaparHtml(i.consultorio.nombreMostrado)}</td></tr>` +
    `<tr><td style="padding:24px;color:#111827;font-size:16px;line-height:1.5">${cuerpoHtml}</td></tr>` +
    `<tr><td style="padding:0 24px 24px">${botones}</td></tr>` +
    `</table></td></tr></table></body></html>`;
  const textoPlano = [
    i.consultorio.nombreMostrado,
    '',
    cuerpoTexto,
    '',
    ...BOTONES.map((b) => `${b.etiqueta}: ${i.enlaces[b.clave]}`),
  ].join('\n');
  return {
    asunto: rellenar(i.plantillas.correoAsunto, i.datos, { html: false }),
    html,
    texto: textoPlano,
    adjuntos: i.logo ? [{ cid: 'logo', contenido: i.logo, tipo: 'image/png' }] : [],
  };
}
