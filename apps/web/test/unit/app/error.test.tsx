import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import ErrorGlobal from '@/app/error';

afterEach(cleanup);

test('error.tsx: mensaje genérico sin detalles y "Reintentar" llama a reset()', async () => {
  const reset = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(<ErrorGlobal error={new Error('ECONNREFUSED 10.0.0.5:3000')} reset={reset} />);
  expect(screen.getByText('Ocurrió un error. Intenta de nuevo.')).toBeInTheDocument();
  expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(reset).toHaveBeenCalledTimes(1);
});
