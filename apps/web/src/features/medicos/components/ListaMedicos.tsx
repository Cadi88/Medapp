import type { MedicoAgenda } from '@consultorio/contracts';
import Link from 'next/link';

export function ListaMedicos({ medicos }: { medicos: MedicoAgenda[] }) {
  if (medicos.length === 0) return <p className="text-muted-foreground">Aún no hay médicos en el consultorio</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {medicos.map((m) => (
        <li key={m.usuarioId} className="rounded-lg border p-4">
          <Link href={`/medicos/${m.usuarioId}`} className="font-medium underline-offset-4 hover:underline">
            {m.nombre}
          </Link>
        </li>
      ))}
    </ul>
  );
}
