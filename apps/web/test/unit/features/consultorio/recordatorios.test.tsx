import '@testing-library/jest-dom/vitest';
import type { ConfigRecordatoriosDto } from '@consultorio/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DATOS_DE_EJEMPLO, rellenar, validarPlantillas, LIMITES_PLANTILLA } from '@/features/consultorio/logica/plantillas';

const m = vi.hoisted(() => ({ guardarConfigRecordatorios: vi.fn() }));
vi.mock('@/features/consultorio/actions', () => ({ guardarConfigRecordatorios: m.guardarConfigRecordatorios }));

const { SeccionRecordatorios } = await import('@/features/consultorio/components/SeccionRecordatorios');

const config: ConfigRecordatoriosDto = {
  modo: 'con_revision',
  horaEnvio: '10:00',
  plantillas: {
    correoAsunto: 'Recordatorio en {consultorio}',
    correoCuerpo: 'Hola {paciente}, tu cita con {medico} es el {fecha} a las {hora}.',
    whatsapp: 'Hola {paciente}, ¿nos confirmas? Llama al {telefono_consultorio}.',
  },
};

afterEach(cleanup);

describe('rellenar', () => {
  const datos = { ...DATOS_DE_EJEMPLO, paciente: 'Ana', consultorio: 'Dental Sol' };

  test('sustituye los campos conocidos y deja los desconocidos', () => {
    expect(rellenar('Hola {paciente} en {consultorio} {otro}', datos)).toBe('Hola Ana en Dental Sol {otro}');
  });

  test('una sola pasada: un valor con llaves no se vuelve a sustituir', () => {
    expect(rellenar('{paciente} {medico}', { ...datos, paciente: '{medico}', medico: 'Dra. Ruiz' })).toBe('{medico} Dra. Ruiz');
  });

  test('un campo heredado del prototipo no cuenta', () => {
    expect(rellenar('{constructor}', datos)).toBe('{constructor}');
  });
});

describe('validarPlantillas', () => {
  const ok = { correoAsunto: 'a', correoCuerpo: 'b', whatsapp: 'c' };

  test('válidas', () => {
    expect(validarPlantillas(ok)).toEqual({ ok: true });
    expect(validarPlantillas({ correoAsunto: 'x'.repeat(120), correoCuerpo: 'x'.repeat(1000), whatsapp: 'x'.repeat(700) })).toEqual({ ok: true });
  });

  test('vacía o demasiado larga, con el campo y el texto', () => {
    expect(validarPlantillas({ ...ok, correoAsunto: '   ' })).toEqual({ ok: false, campo: 'correoAsunto', error: 'La plantilla no puede estar vacía' });
    expect(validarPlantillas({ ...ok, correoCuerpo: 'x'.repeat(1001) })).toEqual({ ok: false, campo: 'correoCuerpo', error: 'Máximo 1000 caracteres' });
    expect(validarPlantillas({ ...ok, whatsapp: 'x'.repeat(701) })).toEqual({ ok: false, campo: 'whatsapp', error: 'Máximo 700 caracteres' });
    expect(LIMITES_PLANTILLA).toEqual({ correoAsunto: 120, correoCuerpo: 1000, whatsapp: 700 });
  });
});

describe('SeccionRecordatorios', () => {
  const mostrar = (c = config) => render(<SeccionRecordatorios config={c} consultorio="Dental Sol" telefono="+525512345678" />);

  test('lista los campos y la vista previa rellena con datos de ejemplo y el consultorio', () => {
    mostrar();
    for (const campo of ['{paciente}', '{fecha}', '{hora}', '{medico}', '{consultorio}', '{telefono_consultorio}']) {
      expect(screen.getByText(campo, { selector: 'code' })).toBeInTheDocument();
    }
    expect(screen.getByTestId('vista-asunto')).toHaveTextContent('Recordatorio en Dental Sol');
    expect(screen.getByTestId('vista-cuerpo')).toHaveTextContent(`Hola ${DATOS_DE_EJEMPLO.paciente}, tu cita con ${DATOS_DE_EJEMPLO.medico}`);
    expect(screen.getByTestId('vista-whatsapp')).toHaveTextContent('Llama al +525512345678');
  });

  test('la vista previa sigue lo que se escribe', () => {
    mostrar();
    fireEvent.change(screen.getByLabelText('Cuerpo del correo'), { target: { value: 'Te esperamos, {paciente}' } });
    expect(screen.getByTestId('vista-cuerpo')).toHaveTextContent(`Te esperamos, ${DATOS_DE_EJEMPLO.paciente}`);
  });

  test('una plantilla de 1001 caracteres muestra el error y no se puede guardar', () => {
    mostrar();
    fireEvent.change(screen.getByLabelText('Cuerpo del correo'), { target: { value: 'x'.repeat(1001) } });
    expect(screen.getByText('Máximo 1000 caracteres')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar recordatorios' })).toBeDisabled();
  });

  test('una plantilla vacía no se puede guardar', () => {
    mostrar();
    fireEvent.change(screen.getByLabelText('Asunto del correo'), { target: { value: '  ' } });
    expect(screen.getByText('La plantilla no puede estar vacía')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar recordatorios' })).toBeDisabled();
  });

  test('ofrece los dos modos con su texto y la hora de envío', () => {
    mostrar();
    expect(screen.getByRole('option', { name: 'Con revisión: solo se envía lo aprobado' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sin revisión: todo se envía solo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hora de envío')).toHaveValue('10:00');
  });

  test('sin teléfono del consultorio la vista previa usa uno de ejemplo', () => {
    render(<SeccionRecordatorios config={config} consultorio="Dental Sol" telefono={null} />);
    expect(screen.getByTestId('vista-whatsapp')).toHaveTextContent(DATOS_DE_EJEMPLO.telefono_consultorio);
  });
});
