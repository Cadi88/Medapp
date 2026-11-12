'use client';

import type { BloqueHorarioDto } from '@consultorio/contracts';
import { useActionState, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvisoDeError } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { guardarSemana } from '../actions';
import { bloquesDeDia, DIAS, semanaDesdeFormulario, validarSemana } from '../logica/semana';

interface Fila {
  clave: number;
  dia: number;
  inicio: string;
  fin: string;
}

interface Props {
  medicoId: string;
  bloques: BloqueHorarioDto[];
}

/** Horario semanal recurrente: uno o más bloques por día. Se guarda la semana completa. */
export function FormularioHorario({ medicoId, bloques }: Props) {
  const [filas, setFilas] = useState<Fila[]>(() =>
    DIAS.flatMap((d) => bloquesDeDia(bloques, d.valor).map((b) => ({ dia: d.valor, inicio: b.horaInicio, fin: b.horaFin }))).map((f, clave) => ({ clave, ...f })),
  );
  const agregar = (dia: number) => setFilas((fs) => [...fs, { clave: Math.max(-1, ...fs.map((f) => f.clave)) + 1, dia, inicio: '', fin: '' }]);
  const [errorLocal, setErrorLocal] = useState<string>();
  const [estado, accion, enviando] = useActionState<EstadoFormulario, FormData>(guardarSemana, {});

  const cambiar = (clave: number, campo: 'inicio' | 'fin', valor: string) =>
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)));

  // Misma validación que el servicio, antes de enviar: evita el viaje de ida y vuelta por un error evidente.
  const validar = (e: FormEvent<HTMLFormElement>) => {
    const v = validarSemana(semanaDesdeFormulario(new FormData(e.currentTarget)));
    setErrorLocal(v.ok ? undefined : v.error);
    if (!v.ok) e.preventDefault();
  };

  return (
    <form action={accion} onSubmit={validar} className="grid gap-4" noValidate aria-label="Horario semanal">
      <input type="hidden" name="medicoId" value={medicoId} />
      <AvisoDeError mensaje={errorLocal ?? estado.mensaje} />
      {estado.ok && !errorLocal ? <p role="status" className="text-sm text-muted-foreground">Horario guardado</p> : null}
      {DIAS.map((d) => {
        const delDia = filas.filter((f) => f.dia === d.valor);
        return (
          <fieldset key={d.valor} className="grid gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{d.nombre}</legend>
            {delDia.length === 0 ? <p className="text-sm text-muted-foreground">Sin atención</p> : null}
            {delDia.map((f) => (
              <div key={f.clave} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="diaSemana" value={f.dia} />
                <Input
                  type="time"
                  name="horaInicio"
                  aria-label={`Inicio ${d.nombre}`}
                  value={f.inicio}
                  onChange={(e) => cambiar(f.clave, 'inicio', e.target.value)}
                  className="w-32"
                />
                <span aria-hidden>a</span>
                <Input
                  type="time"
                  name="horaFin"
                  aria-label={`Fin ${d.nombre}`}
                  value={f.fin}
                  onChange={(e) => cambiar(f.clave, 'fin', e.target.value)}
                  className="w-32"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}>
                  Quitar bloque
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => agregar(d.valor)}>
              Agregar bloque
            </Button>
          </fieldset>
        );
      })}
      <Button type="submit" disabled={enviando} className="w-fit">
        {enviando ? 'Guardando…' : 'Guardar horario'}
      </Button>
    </form>
  );
}
