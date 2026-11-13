import { AppError } from '@consultorio/platform';
import sharp from 'sharp';

/**
 * Decodifica y vuelve a codificar el logo: PNG con lado mayor ≤ 512 px, sin agrandar y sin metadatos
 * (sharp los descarta por omisión). Cualquier fallo de decodificación (imagen corrupta o con más de
 * 25 millones de píxeles) es un error de validación del usuario.
 */
export async function procesarLogo(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    return await sharp(bytes, { limitInputPixels: 25_000_000 })
      .rotate()
      .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new AppError('VALIDACION', 'Sube una imagen PNG, JPG o WebP', 400);
  }
}
