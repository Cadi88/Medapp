import { colorDeTexto } from '@consultorio/contracts';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { errorDeColor } from '../logica/formulario';
import { variablesDeTema } from '../logica/tema';
import { LogoConsultorio } from './LogoConsultorio';

interface Props {
  nombre: string;
  logoVersion: number;
  /** Color que se está eligiendo (#rrggbb); vacío o inválido = tema por omisión. */
  color: string;
}

/** Cómo se verán el encabezado y los botones con el nombre y el color elegidos, antes de guardar. */
export function VistaPreviaEncabezado({ nombre, logoVersion, color }: Props) {
  const valido = color !== '' && errorDeColor(color) === undefined;
  const estilo = variablesDeTema({ colorPrimario: valido ? color : null, colorTexto: valido ? colorDeTexto(color) : null }) as CSSProperties;
  return (
    <div data-testid="vista-previa" aria-label="Vista previa" style={estilo} className="grid gap-3 rounded-md border p-3">
      <div className="flex items-center gap-3 border-b pb-3">
        <LogoConsultorio nombre={nombre} logoVersion={logoVersion} />
        <span className="font-semibold">{nombre}</span>
      </div>
      <Button type="button" tabIndex={-1} className="w-fit">
        Botón principal
      </Button>
    </div>
  );
}
