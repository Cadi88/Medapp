/**
 * URL del logo. `c` (consultorio) y `v` (versión) forman la llave de caché del navegador: la versión es un contador
 * por consultorio, así que sin `c` dos consultorios con la misma versión compartirían la imagen en caché al cambiar
 * de consultorio en el mismo navegador. La ruta ignora ambos parámetros: el logo sale siempre del token de la sesión.
 */
export function urlDelLogo(consultorio: { id: string; logoVersion: number }): string {
  return `/consultorio/logo?c=${encodeURIComponent(consultorio.id)}&v=${consultorio.logoVersion}`;
}
