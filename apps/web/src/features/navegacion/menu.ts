import type { TokenClaims } from '@consultorio/contracts';

export interface OpcionDeMenu {
  texto: string;
  href: string;
}

/**
 * Opciones del menú principal según el rol y el permiso de administrador. Un médico sin admin no ve la lista de
 * médicos: "Médicos" lo lleva a su propia página. "Mi día" va primero para los médicos. Recordatorios es de administración
 * y recepción; Mi consultorio, Equipo y Bitácora, solo de administración.
 */
export function opcionesDeMenu(claims: Pick<TokenClaims, 'sub' | 'rol' | 'admin'>): OpcionDeMenu[] {
  const veTodos = claims.admin || claims.rol === 'recepcion';
  const agenda = { texto: 'Agenda', href: '/agenda' };
  const miDia = { texto: 'Mi día', href: '/mi-dia' };
  return [
    ...(claims.rol === 'medico' ? [miDia, agenda] : [agenda, miDia]),
    { texto: 'Médicos', href: veTodos ? '/medicos' : `/medicos/${claims.sub}` },
    ...(veTodos ? [{ texto: 'Recordatorios', href: '/recordatorios' }] : []),
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
