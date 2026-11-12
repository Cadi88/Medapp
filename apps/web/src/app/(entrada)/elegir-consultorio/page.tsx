import { SelectorConsultorio } from '@/features/sesion/components/selector-consultorio';
import { consultoriosParaElegir } from '@/features/sesion/consultorios';

export default async function ElegirConsultorioPage() {
  return <SelectorConsultorio consultorios={await consultoriosParaElegir()} />;
}
