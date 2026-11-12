'use client';

import type { Bloqueo, BloqueHorarioDto, TipoCita } from '@consultorio/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormularioHorario } from './FormularioHorario';
import { SeccionBloqueos } from './SeccionBloqueos';
import { SeccionTiposCita } from './SeccionTiposCita';

interface Props {
  medicoId: string;
  bloques: BloqueHorarioDto[];
  tipos: TipoCita[];
  bloqueos: Bloqueo[];
  zona: string;
}

/** Las pestañas siguen montadas (solo ocultas) para no perder lo que se está editando al cambiar de una a otra. */
const OCULTA_SI_INACTIVA = 'data-[state=inactive]:hidden';

export function FichaMedico({ medicoId, bloques, tipos, bloqueos, zona }: Props) {
  return (
    <Tabs defaultValue="horario">
      <TabsList>
        <TabsTrigger value="horario">Horario</TabsTrigger>
        <TabsTrigger value="tipos">Tipos de cita</TabsTrigger>
        <TabsTrigger value="bloqueos">Bloqueos</TabsTrigger>
      </TabsList>
      <TabsContent value="horario" forceMount className={OCULTA_SI_INACTIVA}>
        <FormularioHorario medicoId={medicoId} bloques={bloques} />
      </TabsContent>
      <TabsContent value="tipos" forceMount className={OCULTA_SI_INACTIVA}>
        <SeccionTiposCita medicoId={medicoId} tipos={tipos} />
      </TabsContent>
      <TabsContent value="bloqueos" forceMount className={OCULTA_SI_INACTIVA}>
        <SeccionBloqueos medicoId={medicoId} bloqueos={bloqueos} zona={zona} />
      </TabsContent>
    </Tabs>
  );
}
