import { z } from 'zod';
import { uuidv7 } from 'uuidv7';

export const eventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  type: z.string().min(1),
  version: z.number().int().min(1),
  tenant_id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  occurred_at: z.string().datetime(),
  trace_id: z.string().min(1),
  data: z.unknown(),
});

export type EventEnvelope<T = unknown> = {
  event_id: string;
  type: string;
  version: number;
  tenant_id: string;
  actor_id: string | null;
  occurred_at: string;
  trace_id: string;
  data: T;
};

export interface EventDefinition<T> {
  readonly type: string;
  readonly version: number;
  create(i: { tenantId: string; actorId: string | null; traceId: string; data: T }): EventEnvelope<T>;
  parse(raw: unknown): EventEnvelope<T>;
}

export function defineEvent<T>(type: string, version: number, data: z.ZodType<T>): EventDefinition<T> {
  const schema = eventEnvelopeSchema.extend({
    type: z.literal(type),
    version: z.literal(version),
    data,
  });
  return {
    type,
    version,
    create: ({ tenantId, actorId, traceId, data: payload }) => ({
      event_id: uuidv7(),
      type,
      version,
      tenant_id: tenantId,
      actor_id: actorId,
      occurred_at: new Date().toISOString(),
      trace_id: traceId,
      data: payload,
    }),
    parse: (raw) => schema.parse(raw) as EventEnvelope<T>,
  };
}
