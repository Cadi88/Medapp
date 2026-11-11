import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { type ISecurityGroup, type IVpc, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Repository, TagMutability } from 'aws-cdk-lib/aws-ecr';
import {
  AppProtocol,
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  Secret as SecretoEcs,
} from 'aws-cdk-lib/aws-ecs';
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
  ListenerCertificate,
  SslPolicy,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Key, type IKey } from 'aws-cdk-lib/aws-kms';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import type { IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import type { Construct } from 'constructs';
import { CIDR_VPC, PUERTOS } from './red.js';

export interface ServiciosStackProps extends StackProps {
  vpc: IVpc;
  namespace: IPrivateDnsNamespace;
  clave: IKey;
  /** Host (endpoint) de RDS, para dejarlo en los secretos de conexión. */
  hostBd: string;
  natsUrl: string;
  sgBalanceador: ISecurityGroup;
  sgGateway: ISecurityGroup;
  sgIdentidad: ISecurityGroup;
  sgAuditoria: ISecurityGroup;
  /**
   * ARN de un certificado ACM (en mx-central-1) para el listener HTTPS. Sin él, el balanceador escucha solo
   * en HTTP:80; no usar así con datos reales (ver README, sección Infraestructura).
   */
  certificadoArn?: string;
  /** Origen público de la API (BETTER_AUTH_URL), p. ej. https://api.ejemplo.mx. Por defecto, el DNS del balanceador. */
  urlPublica?: string;
}

type NombreApp = 'gateway' | 'svc-identidad' | 'svc-auditoria';
const APPS: NombreApp[] = ['gateway', 'svc-identidad', 'svc-auditoria'];

interface OpcionesServicio {
  puerto: number;
  cpu: number;
  memoria: number;
  sg: ISecurityGroup;
  entorno: Record<string, string>;
  secretos?: Record<string, SecretoEcs>;
}

/**
 * Servicios: repositorios ECR, clúster ECS, servicios Fargate, ALB y secretos.
 *
 * Solo el gateway está detrás del ALB (público); `svc-identidad` y `svc-auditoria` quedan en subredes privadas y
 * se resuelven entre sí por Service Connect (`http://svc-identidad:3001`, `http://svc-auditoria:3003`).
 *
 * El CI (.github/workflows/ci.yml) sube las imágenes a `consultorio/<app>` con la etiqueta del SHA y `latest`
 * y ejecuta `aws ecs update-service --force-new-deployment`; por eso las tareas referencian `:latest`.
 *
 * ARRANQUE MANUAL (una sola vez, por quien despliegue; no lo automatiza CDK):
 *  1. En RDS, crear las bases y roles como `docker/postgres/init.sql` (`identidad_db`/`auditoria_db`, `<svc>_migrator`
 *     dueño de tablas, `<svc>_app` NOBYPASSRLS) usando las contraseñas generadas en los secretos
 *     `consultorio/identidad_app`, `consultorio/identidad_migrator`, `consultorio/auditoria_app` y `consultorio/auditoria_migrator`.
 *  2. Añadir a cada uno de esos cuatro secretos el campo `url` con la cadena de conexión completa
 *     (`postgres://<usuario>:<password>@<host>:5432/<bd>`; usuario, password, host y bd ya están en el secreto):
 *     los servicios leen `DATABASE_URL` y `MIGRATOR_DATABASE_URL` de ese campo.
 *  3. Reemplazar el valor de `consultorio/jwt-private-jwk` por la JWK privada (JSON) que firma los tokens.
 *  Mientras no se haga, las tareas de svc-identidad y svc-auditoria no arrancan (campo/JSON inexistente).
 */
export class ServiciosStack extends Stack {
  readonly cluster: Cluster;
  readonly repositorios = {} as Record<NombreApp, Repository>;

  constructor(scope: Construct, id: string, props: ServiciosStackProps) {
    super(scope, id, props);

    // Se importa por ARN: así los permisos de descifrado van solo en las políticas de los roles de esta stack
    // y la política de la llave (en DatosStack) no referencia roles de aquí (evitaría una dependencia cíclica).
    const clave = Key.fromKeyArn(this, 'Clave', props.clave.keyArn);

    for (const app of APPS) {
      this.repositorios[app] = new Repository(this, `Repo-${app}`, {
        repositoryName: `consultorio/${app}`,
        imageScanOnPush: true,
        imageTagMutability: TagMutability.MUTABLE, // `latest` se reescribe en cada despliegue
        lifecycleRules: [{ description: 'Conservar las últimas 20 imágenes', maxImageCount: 20 }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
    }

    // --- Secretos (valores generados; cifrados con la llave KMS de DatosStack) ---
    const secretoBd = (rol: string, bd: string) =>
      new Secret(this, `Secreto-${rol}`, {
        secretName: `consultorio/${rol}`,
        encryptionKey: clave,
        description: `Credenciales de ${rol} en ${bd}. Falta el campo "url" (arranque manual, ver ServiciosStack).`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: rol, host: props.hostBd, port: '5432', dbname: bd }),
          generateStringKey: 'password',
          passwordLength: 32,
          excludePunctuation: true, // apta para una URL de conexión sin escapar
        },
      });
    const identidadApp = secretoBd('identidad_app', 'identidad_db');
    const identidadMigrator = secretoBd('identidad_migrator', 'identidad_db');
    const auditoriaApp = secretoBd('auditoria_app', 'auditoria_db');
    const auditoriaMigrator = secretoBd('auditoria_migrator', 'auditoria_db');
    const betterAuth = new Secret(this, 'SecretoBetterAuth', {
      secretName: 'consultorio/better-auth-secret',
      encryptionKey: clave,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
    });
    const jwk = new Secret(this, 'SecretoJwk', {
      secretName: 'consultorio/jwt-private-jwk',
      encryptionKey: clave,
      description: 'Marcador: reemplazar por la JWK privada (JSON) que firma los tokens (arranque manual).',
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
    });

    // --- Clúster y balanceador ---
    this.cluster = new Cluster(this, 'Cluster', {
      clusterName: 'consultorio',
      vpc: props.vpc,
    });

    const alb = new ApplicationLoadBalancer(this, 'Balanceador', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroup: props.sgBalanceador,
    });
    const urlPublica = props.urlPublica ?? `${props.certificadoArn ? 'https' : 'http'}://${alb.loadBalancerDnsName}`;

    // --- Definición común de cada servicio (todos ofrecen su nombre por Service Connect) ---
    const crearServicio = (app: NombreApp, o: OpcionesServicio) => {
      const tarea = new FargateTaskDefinition(this, `Tarea-${app}`, { cpu: o.cpu, memoryLimitMiB: o.memoria });
      const contenedor = tarea.addContainer(app, {
        image: ContainerImage.fromEcrRepository(this.repositorios[app], 'latest'),
        environment: { NODE_ENV: 'production', PORT: String(o.puerto), ...o.entorno },
        secrets: o.secretos,
        logging: LogDrivers.awsLogs({ streamPrefix: app, logRetention: RetentionDays.THREE_MONTHS }),
        // ECS ignora el HEALTHCHECK del Dockerfile: se repite aquí (mismo comando; la imagen no trae curl).
        healthCheck: {
          command: [
            'CMD',
            'node',
            '-e',
            `fetch('http://127.0.0.1:${o.puerto}/salud').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
          ],
          interval: Duration.seconds(30),
          timeout: Duration.seconds(5),
          retries: 3,
          startPeriod: Duration.seconds(30),
        },
      });
      contenedor.addPortMappings({ name: 'http', containerPort: o.puerto, appProtocol: AppProtocol.http });

      return new FargateService(this, `Servicio-${app}`, {
        serviceName: app,
        cluster: this.cluster,
        taskDefinition: tarea,
        desiredCount: 1,
        minHealthyPercent: 100, // con una sola tarea, arrancar la nueva antes de retirar la anterior
        maxHealthyPercent: 200,
        securityGroups: [o.sg],
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        circuitBreaker: { rollback: true },
        serviceConnectConfiguration: {
          namespace: props.namespace.namespaceArn,
          services: [{ portMappingName: 'http', dnsName: app, port: o.puerto }],
        },
      });
    };

    const urlIdentidad = `http://svc-identidad:${PUERTOS.identidad}`;
    const urlAuditoria = `http://svc-auditoria:${PUERTOS.auditoria}`;
    const urlBd = (secreto: Secret) => SecretoEcs.fromSecretsManager(secreto, 'url');

    const gateway = crearServicio('gateway', {
      puerto: PUERTOS.gateway,
      cpu: 256,
      memoria: 512,
      sg: props.sgGateway,
      entorno: {
        JWKS_URL: `${urlIdentidad}/.well-known/jwks.json`,
        IDENTIDAD_URL: urlIdentidad,
        AUDITORIA_URL: urlAuditoria,
        // El ALB está en las subredes públicas de la VPC: confiar en X-Forwarded-For solo de ese rango.
        CONFIAR_EN_PROXY: CIDR_VPC,
      },
    });
    crearServicio('svc-identidad', {
      puerto: PUERTOS.identidad,
      cpu: 512,
      memoria: 1024,
      sg: props.sgIdentidad,
      entorno: { NATS_URL: props.natsUrl, BETTER_AUTH_URL: urlPublica },
      secretos: {
        DATABASE_URL: urlBd(identidadApp),
        MIGRATOR_DATABASE_URL: urlBd(identidadMigrator),
        JWT_PRIVATE_JWK: SecretoEcs.fromSecretsManager(jwk),
        BETTER_AUTH_SECRET: SecretoEcs.fromSecretsManager(betterAuth),
      },
    });
    crearServicio('svc-auditoria', {
      puerto: PUERTOS.auditoria,
      cpu: 256,
      memoria: 512,
      sg: props.sgAuditoria,
      entorno: {
        NATS_URL: props.natsUrl,
        // Identidad solo acepta al gateway; el JWKS se lee por la ruta pública del gateway (Service Connect).
        JWKS_URL: `http://gateway:${PUERTOS.gateway}/api/identidad/.well-known/jwks.json`,
      },
      secretos: { DATABASE_URL: urlBd(auditoriaApp), MIGRATOR_DATABASE_URL: urlBd(auditoriaMigrator) },
    });

    // --- Listener: HTTPS con certificado; sin él, HTTP:80 (solo para pruebas) ---
    const objetivos = {
      port: PUERTOS.gateway,
      protocol: ApplicationProtocol.HTTP,
      targets: [gateway.loadBalancerTarget({ containerName: 'gateway', containerPort: PUERTOS.gateway })],
      healthCheck: { path: '/salud' },
      deregistrationDelay: Duration.seconds(30),
    };
    if (props.certificadoArn) {
      alb
        .addListener('Https', {
          port: 443,
          protocol: ApplicationProtocol.HTTPS,
          certificates: [ListenerCertificate.fromArn(props.certificadoArn)],
          sslPolicy: SslPolicy.RECOMMENDED_TLS,
          open: false,
        })
        .addTargets('Gateway', objetivos);
      alb.addListener('Http', {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        open: false,
        defaultAction: ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
    } else {
      alb.addListener('Http', { port: 80, protocol: ApplicationProtocol.HTTP, open: false }).addTargets('Gateway', objetivos);
    }
  }
}
