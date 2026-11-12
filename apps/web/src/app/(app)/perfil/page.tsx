import { datosOFalla } from '@/features/comun/errores';
import { listarMiembros } from '@/features/equipo/api';
import { FormularioPasswordPerfil } from '@/features/perfil/components/FormularioPasswordPerfil';
import { FormularioPerfilMedico } from '@/features/perfil/components/FormularioPerfilMedico';
import { obtenerContexto } from '@/lib/sesion/contexto';

export default async function PerfilPage() {
  const { claims } = await obtenerContexto();
  const yo = datosOFalla(await listarMiembros(), 'el perfil').find((m) => m.usuarioId === claims.sub);
  return (
    <div className="grid gap-8">
      <h1 className="text-2xl font-semibold">Perfil</h1>
      {yo ? (
        <section className="grid gap-1">
          <p className="font-medium">{yo.nombre}</p>
          <p className="text-sm text-muted-foreground">{yo.email}</p>
        </section>
      ) : null}
      {claims.rol === 'medico' ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">Perfil profesional</h2>
          <FormularioPerfilMedico perfil={yo?.perfilMedico ?? null} />
        </section>
      ) : null}
      <section className="grid gap-3">
        <h2 className="text-lg font-medium">Contraseña</h2>
        <FormularioPasswordPerfil />
      </section>
    </div>
  );
}
