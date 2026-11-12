import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { outboxInboxSql, rlsPolicySql } from '@consultorio/platform';
import { describe, expect, test } from 'vitest';

const m001 = readFileSync(fileURLToPath(new URL('../../migrations/001_agenda.sql', import.meta.url)), 'utf8');
const TABLAS = ['consultorio', 'medico', 'tipo_cita', 'horario', 'bloqueo', 'cita'];

describe('migración 001_agenda', () => {
  test('incluye literalmente el SQL de inbox/outbox para agenda_app (anti-deriva)', () => {
    expect(m001).toContain(outboxInboxSql('agenda_app'));
  });
  test.each(TABLAS)('RLS estándar en %s', (t) => {
    expect(m001).toContain(rlsPolicySql(t));
  });
  test('crea btree_gist y las tablas', () => {
    expect(m001).toMatch(/CREATE EXTENSION IF NOT EXISTS btree_gist/);
    for (const t of TABLAS) expect(m001).toContain(`CREATE TABLE ${t} (`);
  });
  test('invariantes en la base: exclusiones, checks y unicidad', () => {
    expect(m001).toMatch(/CONSTRAINT cita_sin_traslape EXCLUDE USING gist/);
    expect(m001).toMatch(/WHERE \(estado <> 'cancelada'\)/);
    expect(m001).toMatch(/EXCLUDE USING gist \(\s+tenant_id WITH =,\s+medico_id WITH =,\s+dia_semana WITH =,\s+tsrange/);
    expect(m001).toMatch(/duracion_min int NOT NULL CHECK \(duracion_min BETWEEN 5 AND 480\)/);
    expect(m001).toMatch(/UNIQUE INDEX tipo_cita_nombre_activo ON tipo_cita \(tenant_id, medico_id, lower\(nombre\)\) WHERE activo/);
  });
  test('agenda_app recibe permisos sobre las tablas de negocio', () => {
    expect(m001).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON [^;]*\bcita\b[^;]* TO "agenda_app"/);
  });
});
