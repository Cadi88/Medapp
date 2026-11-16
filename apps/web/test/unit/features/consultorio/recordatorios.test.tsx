import '@testing-library/jest-dom/vitest';
import type { ConfigRecordatoriosDto } from '@consultorio/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DATOS_DE_EJEMPLO } from '@/features/consultorio/logica/plantillas';

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
