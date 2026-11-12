/** Doble de `cookies()` de `next/headers`: un almacén en memoria que registra cada `set`. */
export interface CookieGuardada {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

export function crearAlmacenCookies() {
  const cookies = new Map<string, CookieGuardada>();
  const almacen = {
    get: (name: string) => cookies.get(name),
    getAll: () => [...cookies.values()],
    has: (name: string) => cookies.has(name),
    set: (name: string, value: string, opciones: Omit<CookieGuardada, 'name' | 'value'> = {}) => {
      if (opciones.maxAge === 0) cookies.delete(name);
      else cookies.set(name, { name, value, ...opciones });
      sets.push({ name, value, ...opciones });
      return almacen;
    },
  };
  const sets: CookieGuardada[] = [];
  return {
    almacen,
    sets,
    poner: (name: string, value: string) => cookies.set(name, { name, value }),
    limpiar: () => {
      cookies.clear();
      sets.length = 0;
    },
  };
}
