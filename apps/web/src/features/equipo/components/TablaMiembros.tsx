import type { Miembro } from '@consultorio/contracts';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilaMiembro } from './FilaMiembro';

export function TablaMiembros({ miembros }: { miembros: Miembro[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Persona</TableHead>
          <TableHead>Rol y permisos</TableHead>
          <TableHead>Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {miembros.map((m) => (
          <FilaMiembro key={m.usuarioId} miembro={m} />
        ))}
      </TableBody>
    </Table>
  );
}
