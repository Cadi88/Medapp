/** Teléfono del consultorio como enlace para llamar; sin teléfono no dibuja nada. */
export function Telefono({ telefono }: { telefono: string | undefined }) {
  return telefono ? (
    <a href={`tel:${telefono}`} className="font-medium underline">
      {telefono}
    </a>
  ) : null;
}
