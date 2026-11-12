import { rolSchema } from '@consultorio/contracts';
import { z } from 'zod';

const passwordTemporal = z
  .string({ error: 'La contraseña temporal es obligatoria' })
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña no puede pasar de 128 caracteres');
const rol = z.enum(rolSchema.options, { error: 'Elige un rol' });

export const altaMiembroSchema = z.object({
  nombre: z.string({ error: 'El nombre es obligatorio' }).trim().min(1, 'El nombre es obligatorio').max(120, 'Máximo 120 caracteres'),
  email: z
    .string({ error: 'El correo es obligatorio' })
    .trim()
    .min(1, 'El correo es obligatorio')
    .pipe(z.email('Escribe un correo válido')),
  rol,
  admin: z.boolean(),
  passwordTemporal,
});

export const editarMiembroFormSchema = z.object({ usuarioId: z.uuid(), rol, admin: z.boolean() });
export const reiniciarPasswordSchema = z.object({ usuarioId: z.uuid(), passwordTemporal });
export const quitarMiembroSchema = z.object({ usuarioId: z.uuid() });

export const MENSAJE_ULTIMO_ADMIN = 'El consultorio necesita al menos un administrador';
