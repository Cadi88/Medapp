// @vitest-environment node
import { describe, expect, test } from 'vitest';
import nextConfig from '../../../next.config';

describe('next.config: cabeceras de seguridad', () => {
  test('todas las rutas impiden incrustar el sitio en marcos y fijan nosniff y Referrer-Policy', async () => {
    const reglas = (await nextConfig.headers?.()) ?? [];
    const todas = reglas.find((r) => r.source === '/:path*');
    expect(todas).toBeDefined();
    const cabeceras = Object.fromEntries((todas?.headers ?? []).map((h) => [h.key, h.value]));
    expect(cabeceras).toEqual({
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });

  test('las acciones del servidor aceptan cuerpos de hasta 2 MB (el logo se valida a 1 MB en la acción)', () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe('2mb');
  });

  test('la CSP no restringe scripts ni estilos (Next y FullCalendar los insertan en línea)', async () => {
    const csp = (await nextConfig.headers?.())?.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });
});
