import { describe, expect, test } from 'vitest';
import { crearLimitador } from '../../src/consumidor.js';

describe('crearLimitador', () => {
  test('nunca hay más de `max` tareas en vuelo y las demás se atienden en orden', async () => {
    const limitar = crearLimitador(3);
    let activas = 0;
    let maximo = 0;
    const orden: number[] = [];
    const tarea = (i: number) => () =>
      (async () => {
        activas += 1;
        maximo = Math.max(maximo, activas);
        orden.push(i);
        await new Promise((r) => setTimeout(r, 5));
        activas -= 1;
        return i;
      })();
    const r = await Promise.all(Array.from({ length: 8 }, (_, i) => limitar(tarea(i))));
    expect(r).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maximo).toBe(3);
    expect(orden).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('una tarea que falla libera su turno', async () => {
    const limitar = crearLimitador(1);
    await expect(limitar(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limitar(async () => 'ok')).resolves.toBe('ok');
  });
});
