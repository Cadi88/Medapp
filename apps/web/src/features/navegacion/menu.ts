import type { TokenClaims } from '@consultorio/contracts';

export interface OpcionDeMenu {
  texto: string;
  href: string;
}

/**
 * Opciones del menú principal según el rol y el permiso de administrador. Un médico sin admin no ve la lista de
 * médicos: "Médicos" lo lleva a su propia página. Mi consultorio, Equipo y Bitácora son solo de administración.
 */
export function opcionesDeMenu(claims: Pick<TokenClaims, 'sub' | 'rol' | 'admin'>): OpcionDeMenu[] {
  const veTodos = claims.admin || claims.rol === 'recepcion';
  return [
    { texto: 'Agenda', href: '/agenda' },
    { texto: 'Médicos', href: veTodos ? '/medicos' : `/medicos/${claims.sub}` },
    ...(claims.admin
      ? [
          { texto: 'Mi consultorio', href: '/consultorio' },
          { texto: 'Equipo', href: '/equipo' },
          { texto: 'Bitácora', href: '/bitacora' },
        ]
      : []),
    { texto: 'Perfil', href: '/perfil' },
  ];
}
