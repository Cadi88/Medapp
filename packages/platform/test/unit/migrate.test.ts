import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { listMigrationFiles } from '../../src/index.js';

describe('listMigrationFiles', () => {
  test('devuelve solo *.sql en orden léxico', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    try {
      for (const f of ['0002_b.sql', '0001_a.sql', 'README.md', '0010_c.sql']) writeFileSync(join(dir, f), '');
      expect(listMigrationFiles(dir)).toEqual(['0001_a.sql', '0002_b.sql', '0010_c.sql']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
