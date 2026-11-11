import { App } from 'aws-cdk-lib';
import { DatosStack } from './datos.js';
import { MensajeriaStack } from './mensajeria.js';
import { RedStack } from './red.js';
import { ServiciosStack } from './servicios.js';

export const REGION = 'mx-central-1';

export interface OpcionesApp {
  /** ARN de un certificado ACM para HTTPS (si falta, se lee el contexto `certificadoArn`). */
  certificadoArn?: string;
  /** Origen público de la API (si falta, se lee el contexto `urlPublica`). */
  urlPublica?: string;
}

/** Arma las cuatro stacks. Es una función (y no código suelto en bin/app.ts) para poder probarla sin sintetizar a disco. */
export function crearApp(opciones: OpcionesApp = {}) {
  const app = new App();
  // La cuenta es opcional: sin CDK_DEFAULT_ACCOUNT la síntesis es agnóstica de cuenta y no consulta AWS.
  const env = { region: REGION, account: process.env.CDK_DEFAULT_ACCOUNT };
  const contexto = (clave: string): string | undefined => {
    const v: unknown = app.node.tryGetContext(clave);
    return typeof v === 'string' && v !== '' ? v : undefined;
  };

  const red = new RedStack(app, 'Consultorio-Red', { env });
  const datos = new DatosStack(app, 'Consultorio-Datos', {
    env,
    vpc: red.vpc,
    sgClientes: [red.sgIdentidad, red.sgAuditoria],
  });
  const mensajeria = new MensajeriaStack(app, 'Consultorio-Mensajeria', {
    env,
    vpc: red.vpc,
    namespace: red.namespace,
    sgClientes: [red.sgIdentidad, red.sgAuditoria],
  });
  const servicios = new ServiciosStack(app, 'Consultorio-Servicios', {
    env,
    vpc: red.vpc,
    namespace: red.namespace,
    clave: datos.clave,
    hostBd: datos.baseDeDatos.dbInstanceEndpointAddress,
    natsUrl: mensajeria.natsUrl,
    sgBalanceador: red.sgBalanceador,
    sgGateway: red.sgGateway,
    sgIdentidad: red.sgIdentidad,
    sgAuditoria: red.sgAuditoria,
    certificadoArn: opciones.certificadoArn ?? contexto('certificadoArn'),
    urlPublica: opciones.urlPublica ?? contexto('urlPublica'),
  });
  return { app, stacks: { red, datos, mensajeria, servicios } };
}
