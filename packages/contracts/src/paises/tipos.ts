import { z } from 'zod';

export const codigoPaisSchema = z.enum(['MX', 'BO']);
export type CodigoPais = z.infer<typeof codigoPaisSchema>;

export const monedaSchema = z.enum(['MXN', 'BOB']);
export type Moneda = z.infer<typeof monedaSchema>;

export interface ReglasPais {
  codigo: CodigoPais;
  moneda: Moneda;
  prefijoTelefonico: '+52' | '+591';
  /** Dígitos del número nacional (sin prefijo del país). */
  digitosNacionales: 10 | 8;
  zonasHorarias: string[];
}
