'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AvisoDeError } from '@/features/sesion/components/campo';
import { cargarMasEventos } from '../actions';
import { etiquetaAccion } from '../logica/acciones';
import { formatearFechaEvento, nombreDelActor } from '../logica/filtros';
import type { ConsultaBitacora, EventoAuditoria } from '../tipos';

interface Props {
  eventos: EventoAuditoria[];
  /** Cursor de la página siguiente; `null` = no hay más. */
  siguiente: number | null;
  /** `usuarioId → nombre` de los miembros actuales. */
  nombres: Record<string, string>;
  zona: string;
  filtros: ConsultaBitacora;
}

export function TablaBitacora({ eventos: iniciales, siguiente: cursorInicial, nombres, zona, filtros }: Props) {
  const [eventos, setEventos] = useState(iniciales);
  const [siguiente, setSiguiente] = useState(cursorInicial);
  const [mensaje, setMensaje] = useState<string>();
  const [cargando, iniciar] = useTransition();

  const verMas = () => {
    if (siguiente === null) return;
    const cursor = siguiente;
    iniciar(async () => {
      const r = await cargarMasEventos(filtros, cursor);
      if (!r.ok) return setMensaje(r.mensaje);
      setMensaje(undefined);
      setEventos((previos) => [...previos, ...r.eventos]);
      setSiguiente(r.siguiente);
    });
  };

  if (eventos.length === 0) return <p className="text-muted-foreground">No hay movimientos con estos filtros</p>;
  return (
    <div className="grid gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Quién</TableHead>
            <TableHead>Acción</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {eventos.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{formatearFechaEvento(e.ocurrido_en, zona)}</TableCell>
              <TableCell>{nombreDelActor(e.actor_id, nombres)}</TableCell>
              <TableCell>{etiquetaAccion(e.accion)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AvisoDeError mensaje={mensaje} />
      {siguiente !== null ? (
        <Button variant="outline" className="w-fit" onClick={verMas} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Ver más'}
        </Button>
      ) : null}
    </div>
  );
}
