import { DateTime } from 'luxon';

/** `YYYY-MM-DDTHH:mm` (campo `datetime-local`) en la zona del consultorio → ISO con desfase; `undefined` si no es válido. */
export function instanteDesdeLocal(valor: string, zona: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return undefined;
  const d = DateTime.fromISO(valor, { zone: zona });
  return d.isValid ? (d.toISO() ?? undefined) : undefined;
}

/** "12 nov 2026, 10:00" en la zona del consultorio. */
export function textoLocal(instante: string, zona: string): string {
  return DateTime.fromISO(instante, { zone: zona }).setLocale('es-MX').toFormat('d LLL yyyy, HH:mm');
}
