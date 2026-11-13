import { type CodigoPais, colorValidoSobreBlanco, type Consultorio, normalizarTelefono, reglasDe } from '@consultorio/contracts';

export const MAX_LOGO_BYTES = 1_048_576;
export const TIPOS_LOGO: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

export const MENSAJE_LOGO_PESADO = 'El logo debe pesar menos de 1 MB';
export const MENSAJE_LOGO_TIPO = 'Sube una imagen PNG, JPG o WebP';
export const MENSAJE_COLOR_CLARO = 'Elige un color más oscuro';
export const MENSAJE_COLOR_INVALIDO = 'Color inválido (usa el formato #rrggbb)';

export const MAX_NOMBRE_COMERCIAL = 120;
export const MAX_DIRECCION = 300;
export const MENSAJE_NOMBRE_COMERCIAL = 'El nombre comercial debe tener entre 2 y 120 caracteres';
export const MENSAJE_DIRECCION = 'La dirección no puede pasar de 300 caracteres';

/** Vacío vale (borra el nombre comercial); con texto, de 2 a 120 caracteres. Igual que en identidad. */
export function errorDeNombreComercial(nombre: string): string | undefined {
  const largo = nombre.trim().length;
  return largo === 0 || (largo >= 2 && largo <= MAX_NOMBRE_COMERCIAL) ? undefined : MENSAJE_NOMBRE_COMERCIAL;
}

export function errorDeDireccion(direccion: string): string | undefined {
  return direccion.trim().length > MAX_DIRECCION ? MENSAJE_DIRECCION : undefined;
}

/** Dígitos nacionales de un teléfono guardado (E.164): el prefijo del país se muestra aparte, junto al campo. */
export function telefonoParaMostrar(telefono: string | null | undefined, pais: CodigoPais): string {
  if (!telefono) return '';
  const { prefijoTelefonico } = reglasDe(pais);
  return telefono.startsWith(prefijoTelefonico) ? telefono.slice(prefijoTelefonico.length) : telefono;
}

/** El teléfono tal como lo guarda el servicio (E.164) si es válido; si no, el texto escrito, para que el servicio lo rechace. */
export function telefonoParaComparar(texto: string, pais: CodigoPais): string {
  return texto.trim() === '' ? texto : (normalizarTelefono(texto, pais) ?? texto);
}

const FORMATO_COLOR = /^#[0-9a-f]{6}$/;

/** Misma regla en el navegador (antes de enviar) y en la acción: vacío = sin color propio. */
export function errorDeColor(color: string): string | undefined {
  if (color === '') return undefined;
  if (!FORMATO_COLOR.test(color)) return MENSAJE_COLOR_INVALIDO;
  return colorValidoSobreBlanco(color) ? undefined : MENSAJE_COLOR_CLARO;
}

/** Tipo (PNG, JPG, WebP) y tamaño (≤ 1 MB) del archivo elegido; el servicio vuelve a comprobarlos por los bytes. */
export function errorDeLogo(archivo: Pick<File, 'size' | 'type'>): string | undefined {
  if (archivo.size === 0 || !TIPOS_LOGO.includes(archivo.type)) return MENSAJE_LOGO_TIPO;
  return archivo.size > MAX_LOGO_BYTES ? MENSAJE_LOGO_PESADO : undefined;
}

const CAMPOS = ['nombreComercial', 'direccion', 'telefono', 'colorPrimario'] as const;
export type CampoPersonalizacion = (typeof CAMPOS)[number];
export type ValoresPersonalizacion = Partial<Record<CampoPersonalizacion, string>>;
export type CambiosPersonalizacion = Partial<Record<CampoPersonalizacion, string | null>>;

/**
 * Solo los campos que cambiaron respecto de lo guardado: el texto vacío borra el valor (`null`) y lo que no se
 * envió o no cambió se omite. El color se compara en minúsculas, como lo guarda el servicio.
 */
export function cambiosDePersonalizacion(
  actual: Pick<Consultorio, CampoPersonalizacion>,
  nuevos: ValoresPersonalizacion,
): CambiosPersonalizacion {
  const cambios: CambiosPersonalizacion = {};
  for (const campo of CAMPOS) {
    const bruto = nuevos[campo];
    if (bruto === undefined) continue;
    const texto = campo === 'colorPrimario' ? bruto.trim().toLowerCase() : bruto.trim();
    const valor = texto === '' ? null : texto;
    if (valor !== actual[campo]) cambios[campo] = valor;
  }
  return cambios;
}
