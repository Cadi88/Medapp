'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { CampoSelect } from '@/features/agenda/components/CampoSelect';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import { altaMiembro } from '../actions';
import type { EstadoPasswordTemporal } from '../tipos';
import { AvisoPasswordTemporal } from './AvisoPasswordTemporal';

export function FormularioAltaMiembro() {
  const [estado, accion, enviando] = useActionState<EstadoPasswordTemporal, FormData>(altaMiembro, {});
  const v = estado.valores;
  return (
    <form action={accion} className="grid max-w-xl gap-4" noValidate aria-label="Agregar persona al equipo">
      <AvisoDeError mensaje={estado.mensaje} />
      {estado.passwordTemporal ? <AvisoPasswordTemporal password={estado.passwordTemporal} /> : null}
      <Campo nombre="nombre" etiqueta="Nombre" autoComplete="off" defaultValue={v?.nombre} error={estado.errores?.nombre} />
      <Campo nombre="email" etiqueta="Correo" type="email" autoComplete="off" defaultValue={v?.email} error={estado.errores?.email} />
      <CampoSelect key={`rol-${v?.rol}`} nombre="rol" etiqueta="Rol" defaultValue={v?.rol || 'recepcion'} error={estado.errores?.rol}>
        <option value="recepcion">Recepción</option>
        <option value="medico">Médico</option>
      </CampoSelect>
      <label className="flex items-center gap-2 text-sm">
        <input key={`admin-${v?.admin}`} type="checkbox" name="admin" defaultChecked={v?.admin === 'on'} />
        Administrador del consultorio
      </label>
      <Campo nombre="passwordTemporal" etiqueta="Contraseña temporal" autoComplete="off" error={estado.errores?.passwordTemporal} />
      <Button type="submit" disabled={enviando} className="w-fit">
        {enviando ? 'Agregando…' : 'Agregar al equipo'}
      </Button>
    </form>
  );
}
