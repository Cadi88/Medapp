'use client';

import { useActionState, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { AvisoDeError, MensajeDeCampo } from '@/features/sesion/components/campo';
import type { EstadoFormulario } from '@/features/sesion/tipos';
import { quitarLogo, subirLogo } from '../actions';
import { errorDeLogo, TIPOS_LOGO } from '../logica/formulario';
import { LogoConsultorio } from './LogoConsultorio';

interface Props {
  nombre: string;
  logoVersion: number;
}

/** Vista previa del logo actual, "Cambiar" (elige y sube) y "Quitar". El archivo se valida aquí antes de enviarlo. */
export function SeccionLogo({ nombre, logoVersion }: Props) {
  const formulario = useRef<HTMLFormElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const [errorLocal, setErrorLocal] = useState<string>();
  const [subida, accionSubir, subiendo] = useActionState<EstadoFormulario, FormData>(subirLogo, {});
  const [quitada, accionQuitar, quitando] = useActionState<EstadoFormulario, FormData>(quitarLogo, {});

  const alElegir = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    const error = errorDeLogo(archivo);
    setErrorLocal(error);
    if (error) e.target.value = '';
    else formulario.current?.requestSubmit();
  };

  return (
    <section className="grid max-w-xl gap-3">
      <h2 className="text-lg font-medium">Logo</h2>
      <div className="flex min-h-16 items-center rounded-md border p-3">
        {logoVersion > 0 ? (
          // `key`: un logo nuevo vuelve a intentar la carga aunque el anterior hubiera fallado.
          <LogoConsultorio key={logoVersion} nombre={nombre} logoVersion={logoVersion} className="max-h-24 w-auto max-w-60 object-contain" />
        ) : (
          <p className="text-sm text-muted-foreground">Sin logo</p>
        )}
      </div>
      <form ref={formulario} action={accionSubir} className="flex flex-wrap items-center gap-2">
        <input ref={entrada} type="file" name="logo" accept={TIPOS_LOGO.join(',')} onChange={alElegir} className="hidden" aria-label="Archivo del logo" />
        <Button type="button" variant="outline" disabled={subiendo} onClick={() => entrada.current?.click()}>
          {subiendo ? 'Subiendo…' : 'Cambiar'}
        </Button>
      </form>
      {logoVersion > 0 ? (
        <form action={accionQuitar}>
          <Button type="submit" variant="ghost" disabled={quitando}>
            Quitar
          </Button>
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">PNG, JPG o WebP de hasta 1 MB.</p>
      <MensajeDeCampo id="logo-error">{errorLocal ?? subida.errores?.logo}</MensajeDeCampo>
      <AvisoDeError mensaje={subida.mensaje ?? quitada.mensaje} />
      {subida.ok && !errorLocal ? (
        <p role="status" className="text-sm text-muted-foreground">
          Logo actualizado
        </p>
      ) : null}
    </section>
  );
}
