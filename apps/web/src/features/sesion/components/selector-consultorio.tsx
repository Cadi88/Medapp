'use client';

import { useActionState } from 'react';
import { elegirConsultorio } from '../actions';
import type { ConsultorioDelUsuario, EstadoFormulario } from '../tipos';
import { AvisoDeError } from './campo';
import { MarcoEntrada } from './marco-entrada';

const ROL: Record<ConsultorioDelUsuario['rol'], string> = { medico: 'Médico', recepcion: 'Recepción' };

const descripcionDeRol = (c: ConsultorioDelUsuario) => (c.admin ? `${ROL[c.rol]} · Administrador` : ROL[c.rol]);

export function SelectorConsultorio({ consultorios }: { consultorios: ConsultorioDelUsuario[] }) {
  const [estado, accion] = useActionState<EstadoFormulario, FormData>(elegirConsultorio, {});
  return (
    <MarcoEntrada titulo="Elige un consultorio" descripcion="Perteneces a más de un consultorio. ¿A cuál quieres entrar?">
      <AvisoDeError mensaje={estado.mensaje ?? estado.errores?.tenantId} />
      <ul className="grid gap-2">
        {consultorios.map((c) => (
          <li key={c.tenantId}>
            <form action={accion}>
              <input type="hidden" name="tenantId" value={c.tenantId} />
              <button
                type="submit"
                className="flex w-full flex-col items-start rounded-md border p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="font-medium">{c.nombre}</span>
                <span className="text-sm text-muted-foreground">{descripcionDeRol(c)}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </MarcoEntrada>
  );
}
