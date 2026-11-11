import type { EventEnvelope } from '@consultorio/contracts';
import { canonicalJson, sha256Hex } from '@consultorio/platform';

export const HASH_GENESIS = '0'.repeat(64);

/**
 * Todas las columnas de `evento_auditoria` excepto `hash`, con serialización FIJA (es lo que se hashea):
 * `ocurrido_en` ISO UTC con milisegundos, `secuencia` como string (bigint-safe), `detalle` el objeto JSON del evento.
 */
export interface RegistroAuditoria {
  id: string;
  tenant_id: string;
  secuencia: string;
  ocurrido_en: string;
  actor_id: string | null;
  accion: string;
  recurso_tipo: string;
  recurso_id: string | null;
  servicio: string;
  detalle: unknown;
  hash_anterior: string;
}

/** Una fila tal como la devuelve node-postgres (timestamptz → Date, bigint → string, jsonb → objeto). */
export interface FilaAuditoria {
  id: string;
  tenant_id: string;
  secuencia: string | number | bigint;
  ocurrido_en: Date | string;
  actor_id: string | null;
  accion: string;
  recurso_tipo: string;
  recurso_id: string | null;
  servicio: string;
  detalle: unknown;
  hash_anterior: string;
  hash: string;
}

/** Prefijo del type (`usuario.vinculado` → `usuario`); sin punto, el type completo. */
export const prefijoDe = (type: string): string => type.split('.')[0] ?? type;

/** Servicio dueño por prefijo del type. Tabla pequeña que las fases siguientes amplían. */
const SERVICIO_POR_PREFIJO: Readonly<Record<string, string>> = {
  tenant: 'identidad',
  usuario: 'identidad',
  medico: 'identidad',
};

export const servicioDe = (type: string): string => SERVICIO_POR_PREFIJO[prefijoDe(type)] ?? 'desconocido';

/**
 * Identificador del recurso afectado dentro de `data`. Determinista e independiente del orden de las claves
 * (el jsonb de Postgres las reordena): 1) el campo `<prefijo>Id` (p. ej. `tenantId` para `tenant.*`);
 * 2) si no existe, el primer campo cuyo nombre termina en `Id` en orden alfabético. Solo valores string no vacíos.
 */
export function recursoIdDe(prefijo: string, data: unknown): string | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const valido = (k: string): string | null => {
    const v = o[k];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const propio = valido(`${prefijo}Id`);
  if (propio !== null) return propio;
  for (const k of Object.keys(o).sort()) {
    if (k.length > 2 && k.endsWith('Id')) {
      const v = valido(k);
      if (v !== null) return v;
    }
  }
  return null;
}

/** Registro a insertar para el evento `e` en la posición `secuencia` de la cadena. */
export function construirRegistro(e: EventEnvelope, secuencia: bigint, hashAnterior: string): RegistroAuditoria {
  const prefijo = prefijoDe(e.type);
  return {
    id: e.event_id.toLowerCase(),
    tenant_id: e.tenant_id.toLowerCase(),
    secuencia: secuencia.toString(),
    ocurrido_en: new Date(e.occurred_at).toISOString(),
    actor_id: e.actor_id === null ? null : e.actor_id.toLowerCase(),
    accion: e.type,
    recurso_tipo: prefijo,
    recurso_id: recursoIdDe(prefijo, e.data),
    servicio: servicioDe(e.type),
    // `data` puede faltar (el esquema del sobre lo permite): se guarda como JSON null.
    detalle: e.data === undefined ? null : e.data,
    hash_anterior: hashAnterior,
  };
}

/** Normaliza una fila leída de Postgres exactamente igual que `construirRegistro`. */
export function registroDesdeFila(f: FilaAuditoria): RegistroAuditoria {
  return {
    id: f.id.toLowerCase(),
    tenant_id: f.tenant_id.toLowerCase(),
    secuencia: f.secuencia.toString(),
    ocurrido_en: new Date(f.ocurrido_en).toISOString(),
    actor_id: f.actor_id === null ? null : f.actor_id.toLowerCase(),
    accion: f.accion,
    recurso_tipo: f.recurso_tipo,
    recurso_id: f.recurso_id,
    servicio: f.servicio,
    detalle: f.detalle,
    hash_anterior: f.hash_anterior,
  };
}

export function calcularHash(hashAnterior: string, registro: RegistroAuditoria): string {
  return sha256Hex(hashAnterior + canonicalJson(registro));
}
