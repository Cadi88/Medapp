/** La contraseña temporal solo se ve aquí, una vez: el servidor no la guarda ni se puede consultar después. */
export function AvisoPasswordTemporal({ password }: { password: string }) {
  return (
    <div role="status" className="grid gap-1 rounded-md border bg-muted px-3 py-2 text-sm">
      <p>
        Contraseña temporal: <code className="font-mono font-semibold">{password}</code>
      </p>
      <p className="text-muted-foreground">Compártela con la persona por un medio seguro. No volverá a mostrarse.</p>
    </div>
  );
}
