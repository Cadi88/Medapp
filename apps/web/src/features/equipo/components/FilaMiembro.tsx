'use client';

import type { Miembro } from '@consultorio/contracts';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TableCell, TableRow } from '@/components/ui/table';
import { AvisoDeError, Campo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { editarMiembro, quitarMiembro, reiniciarPassword } from '../actions';
import type { EstadoPasswordTemporal } from '../tipos';
import { AvisoPasswordTemporal } from './AvisoPasswordTemporal';

/** Vive dentro de `DialogContent`: al cerrar el diálogo se desmonta y la contraseña mostrada se descarta. */
function FormularioReinicio({ miembro }: { miembro: Miembro }) {
  const [estado, accion, enviando] = useActionState<EstadoPasswordTemporal, FormData>(reiniciarPassword, {});
  return (
    <form action={accion} className="grid gap-4" noValidate>
      <input type="hidden" name="usuarioId" value={miembro.usuarioId} />
      <AvisoDeError mensaje={estado.mensaje} />
      {estado.passwordTemporal ? <AvisoPasswordTemporal password={estado.passwordTemporal} /> : null}
      <Campo nombre="passwordTemporal" etiqueta="Contraseña temporal" autoComplete="off" error={estado.errores?.passwordTemporal} />
      <DialogFooter>
        <Button type="submit" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Reiniciar contraseña'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ReiniciarPassword({ miembro }: { miembro: Miembro }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reiniciar contraseña
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reiniciar contraseña de {miembro.nombre}</DialogTitle>
          <DialogDescription>Escribe una contraseña temporal; la persona deberá cambiarla al entrar.</DialogDescription>
        </DialogHeader>
        <FormularioReinicio miembro={miembro} />
      </DialogContent>
    </Dialog>
  );
}

function QuitarMiembro({ miembro }: { miembro: Miembro }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(quitarMiembro, {});
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Quitar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Quitar a {miembro.nombre} del consultorio?</DialogTitle>
          <DialogDescription>Dejará de tener acceso a este consultorio. Su historial en la bitácora se conserva.</DialogDescription>
        </DialogHeader>
        <form action={accion} className="grid gap-4">
          <input type="hidden" name="usuarioId" value={miembro.usuarioId} />
          <AvisoDeError mensaje={estado.mensaje} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={enviando}>
              {enviando ? 'Quitando…' : 'Sí, quitar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fila del equipo: rol y permiso de administrador editables, reinicio de contraseña y baja con confirmación. */
export function FilaMiembro({ miembro }: { miembro: Miembro }) {
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(editarMiembro, {});
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{miembro.nombre}</p>
        <p className="text-sm text-muted-foreground">{miembro.email}</p>
        {miembro.debeCambiarPassword ? <p className="text-xs text-muted-foreground">Contraseña temporal pendiente de cambio</p> : null}
      </TableCell>
      <TableCell>
        <form action={accion} className="flex flex-wrap items-center gap-3" aria-label={`Editar a ${miembro.nombre}`}>
          <input type="hidden" name="usuarioId" value={miembro.usuarioId} />
          <select
            name="rol"
            aria-label={`Rol de ${miembro.nombre}`}
            defaultValue={miembro.rol}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          >
            <option value="recepcion">Recepción</option>
            <option value="medico">Médico</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="admin" defaultChecked={miembro.admin} />
            Administrador
          </label>
          <Button type="submit" size="sm" disabled={enviando}>
            Guardar
          </Button>
        </form>
        <AvisoDeError mensaje={estado.mensaje} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <ReiniciarPassword miembro={miembro} />
          <QuitarMiembro miembro={miembro} />
        </div>
      </TableCell>
    </TableRow>
  );
}
