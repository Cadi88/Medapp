'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CampoSelect } from '@/features/agenda/components/CampoSelect';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import { altaMiembro } from '../actions';
import type { EstadoPasswordTemporal } from '../tipos';
import { AvisoPasswordTemporal } from './AvisoPasswordTemporal';

const CUENTA_EXISTENTE = 'Esta persona ya tenía cuenta; entra con su contraseña actual.';

export function FormularioAltaMiembro() {
  const [estado, accion, enviando] = useActionState<EstadoPasswordTemporal, FormData>(altaMiembro, {});
  const v = estado.valores;
  // El aviso se descarta al cerrarlo o al empezar otra alta: la contraseña se muestra una sola vez.
  const [descartado, setDescartado] = useState(false);
  const enviar = (fd: FormData) => {
    setDescartado(false);
    return accion(fd);
  };
  return (
    <form action={enviar} onChange={() => setDescartado(true)} className="grid max-w-xl gap-4" noValidate aria-label="Agregar persona al equipo">
      <AvisoDeError mensaje={estado.mensaje} />
      {(estado.passwordTemporal || estado.cuentaExistente) && !descartado ? (
        <div className="grid gap-2">
          {estado.passwordTemporal ? (
            <AvisoPasswordTemporal password={estado.passwordTemporal} />
          ) : (
            <p role="status" className="rounded-md border bg-muted px-3 py-2 text-sm">
              {CUENTA_EXISTENTE}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setDescartado(true)}>
            Entendido
          </Button>
        </div>
      ) : null}
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
