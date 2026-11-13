import { CfnParameter, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
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
  ListenerCondition,
  SslPolicy,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
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
  /** Bucket de archivos (DatosStack). Solo se usa su nombre y ARN: los permisos van en el rol de la tarea de identidad. */
  bucket: { bucketName: string; bucketArn: string };
  /** Host (endpoint) de RDS, para dejarlo en los secretos de conexión. */
  hostBd: string;
  natsUrl: string;
  sgBalanceador: ISecurityGroup;
  sgGateway: ISecurityGroup;
  sgIdentidad: ISecurityGroup;
  sgAuditoria: ISecurityGroup;
  sgAgenda: ISecurityGroup;
  sgWeb: ISecurityGroup;
  /**
   * ARN de un certificado ACM (en mx-central-1) para el listener HTTPS. Sin él, el balanceador escucha solo
   * en HTTP:80; no usar así con datos reales (ver README, sección Infraestructura).
   */
  certificadoArn?: string;
  /** Origen público del sitio y de la API (comparten el balanceador), p. ej. https://app.ejemplo.mx. Por defecto, el DNS del balanceador. */
  urlPublica?: string;
  /**
   * Etiqueta (SHA de git) de la imagen inicial de las cinco tareas. Sin ella, la stack declara el parámetro de
   * CloudFormation `ImageTag` (sin valor por defecto: el despliegue lo exige). Nunca `latest`.
   */
  imageTag?: string;
}

const PATRON_TAG = '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$';

/** Valida una etiqueta de imagen ECR concreta; `latest` se rechaza (los repositorios son inmutables y CI usa el SHA). */
export function validarImageTag(tag: string): string {
  if (!new RegExp(PATRON_TAG).test(tag) || tag === 'latest') {
    throw new Error(`imageTag inválido: ${JSON.stringify(tag)} (usar el SHA de la imagen)`);
  }
  return tag;
}

type NombreApp = 'gateway' | 'svc-identidad' | 'svc-auditoria' | 'svc-agenda' | 'web';
const APPS: NombreApp[] = ['gateway', 'svc-identidad', 'svc-auditoria', 'svc-agenda', 'web'];

interface OpcionesServicio {
  puerto: number;
  cpu: number;
  memoria: number;
  sg: ISecurityGroup;
  entorno: Record<string, string>;
  secretos?: Record<string, SecretoEcs>;
  /** Ruta HTTP de salud; `/salud` en los servicios. El sitio web no tiene `/salud`: usa `/login` (pública y barata). */
  rutaSalud?: string;
  /** Permisos extra del rol de la tarea (mínimo privilegio, por servicio). */
  permisos?: PolicyStatement[];
}

/**
 * Servicios: repositorios ECR, clúster ECS, servicios Fargate, ALB y secretos.
 *
 * Detrás del ALB (público) están `web` (Next.js, ruta `/`, acción por omisión) y el gateway (`/api/*`). El navegador habla
 * con `web`, que llama al gateway por Service Connect (`http://gateway:8080`). `svc-identidad`, `svc-auditoria` y
 * `svc-agenda` quedan en subredes privadas y solo aceptan al gateway (`http://svc-identidad:3001`,
 * `http://svc-auditoria:3003`, `http://svc-agenda:3004`).
 *
 * IMÁGENES: los repositorios tienen etiquetas inmutables y no existe `:latest`. El CI (.github/workflows/ci.yml) sube
 * `consultorio/<app>:<sha>` y, tras la aprobación del environment `produccion`, registra una revisión nueva de la
 * definición de tarea con esa imagen y la asigna al servicio (`update-service --task-definition`). Así un reemplazo de
 * tarea o el rollback del circuit breaker solo usan imágenes aprobadas. La imagen inicial la fija el primer despliegue:
 * `cdk deploy -c imageTag=<sha>` (o `--parameters Consultorio-Servicios:ImageTag=<sha>`). Un `cdk deploy` posterior
 * debe pasar el SHA que esté en producción, o devolvería las tareas a la etiqueta indicada.
 *
 * ARRANQUE MANUAL (una sola vez, por quien despliegue; no lo automatiza CDK):
 *  1. En RDS (una sola instancia), crear las bases y roles como `docker/postgres/init.sql` (`identidad_db`/`auditoria_db`/
 *     `agenda_db`, `<svc>_migrator` dueño de tablas, `<svc>_app` NOBYPASSRLS) usando las contraseñas generadas en los
 *     secretos `consultorio/<svc>_app` y `consultorio/<svc>_migrator` de identidad, auditoria y agenda.
 *  2. Añadir a cada uno de esos seis secretos el campo `url` con la cadena de conexión completa
 *     (`postgres://<usuario>:<password>@<host>:5432/<bd>`; usuario, password, host y bd ya están en el secreto):
 *     los servicios leen `DATABASE_URL` y `MIGRATOR_DATABASE_URL` de ese campo.
 *  3. Reemplazar el valor de `consultorio/jwt-private-jwk` por la JWK privada (JSON) que firma los tokens.
 *  Mientras no se haga, las tareas de svc-identidad, svc-auditoria y svc-agenda no arrancan (campo/JSON inexistente).
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
        imageTagMutability: TagMutability.IMMUTABLE, // solo :<sha>; una etiqueta publicada no se reescribe
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
    const agendaApp = secretoBd('agenda_app', 'agenda_db');
    const agendaMigrator = secretoBd('agenda_migrator', 'agenda_db');
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

    // --- Etiqueta de la imagen inicial: opción/contexto `imageTag` o parámetro `ImageTag` obligatorio al desplegar ---
    const etiqueta =
      props.imageTag !== undefined
        ? validarImageTag(props.imageTag)
        : new CfnParameter(this, 'ImageTag', {
            type: 'String',
            description: 'SHA de git de la imagen inicial de las tareas (consultorio/<app>:<sha>). CI registra las revisiones siguientes.',
            allowedPattern: PATRON_TAG,
          }).valueAsString;

    // --- Definición común de cada servicio (todos ofrecen su nombre por Service Connect) ---
    const crearServicio = (app: NombreApp, o: OpcionesServicio) => {
      const tarea = new FargateTaskDefinition(this, `Tarea-${app}`, { cpu: o.cpu, memoryLimitMiB: o.memoria });
      for (const permiso of o.permisos ?? []) tarea.addToTaskRolePolicy(permiso);
      const contenedor = tarea.addContainer(app, {
        image: ContainerImage.fromEcrRepository(this.repositorios[app], etiqueta),
        environment: { NODE_ENV: 'production', PORT: String(o.puerto), ...o.entorno },
        secrets: o.secretos,
        logging: LogDrivers.awsLogs({ streamPrefix: app, logRetention: RetentionDays.THREE_MONTHS }),
        // ECS ignora el HEALTHCHECK del Dockerfile: se repite aquí (mismo comando; la imagen no trae curl).
        healthCheck: {
          command: [
            'CMD',
            'node',
            '-e',
            `fetch('http://127.0.0.1:${o.puerto}${o.rutaSalud ?? '/salud'}').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
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
    const urlAgenda = `http://svc-agenda:${PUERTOS.agenda}`;
    const jwksPorGateway = `http://gateway:${PUERTOS.gateway}/api/identidad/.well-known/jwks.json`;
    const https = props.certificadoArn !== undefined;
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
        AGENDA_URL: urlAgenda,
        // El ALB está en las subredes públicas de la VPC: confiar en X-Forwarded-For solo de ese rango.
        CONFIAR_EN_PROXY: CIDR_VPC,
      },
    });
    crearServicio('svc-identidad', {
      puerto: PUERTOS.identidad,
      cpu: 512,
      memoria: 1024,
      sg: props.sgIdentidad,
      // El sitio y la API comparten origen (el balanceador): es el único que Better Auth debe aceptar con cookies.
      entorno: {
        NATS_URL: props.natsUrl,
        BETTER_AUTH_URL: urlPublica,
        ORIGENES_CONFIABLES: urlPublica,
        // Logos del consultorio. Sin S3_ENDPOINT ni llaves: en AWS el SDK usa el rol de la tarea.
        S3_BUCKET: props.bucket.bucketName,
        S3_REGION: this.region,
      },
      permisos: [
        // Solo los logos: ni el resto del bucket ni ListBucket.
        new PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${props.bucket.bucketArn}/logos/*`],
        }),
        // El bucket se cifra con la llave KMS del stack de datos.
        new PolicyStatement({ actions: ['kms:Decrypt', 'kms:GenerateDataKey'], resources: [props.clave.keyArn] }),
      ],
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
        JWKS_URL: jwksPorGateway,
      },
      secretos: { DATABASE_URL: urlBd(auditoriaApp), MIGRATOR_DATABASE_URL: urlBd(auditoriaMigrator) },
    });
    crearServicio('svc-agenda', {
      puerto: PUERTOS.agenda,
      cpu: 256,
      memoria: 512,
      sg: props.sgAgenda,
      entorno: { NATS_URL: props.natsUrl, JWKS_URL: jwksPorGateway },
      secretos: { DATABASE_URL: urlBd(agendaApp), MIGRATOR_DATABASE_URL: urlBd(agendaMigrator) },
    });
    const web = crearServicio('web', {
      puerto: PUERTOS.web,
      cpu: 512,
      memoria: 1024,
      sg: props.sgWeb,
      rutaSalud: '/login',
      entorno: {
        GATEWAY_URL: `http://gateway:${PUERTOS.gateway}`,
        COOKIE_SEGURA: https ? 'true' : 'false',
        WEB_ORIGEN: urlPublica,
        HOSTNAME: '0.0.0.0', // Next standalone escucha en HOSTNAME; sin esto usaría el nombre del contenedor
      },
    });

    // --- Listener: HTTPS con certificado; sin él, HTTP:80 (solo para pruebas). Por omisión todo va a web; /api/* al gateway ---
    const destinoWeb = {
      port: PUERTOS.web,
      protocol: ApplicationProtocol.HTTP,
      targets: [web.loadBalancerTarget({ containerName: 'web', containerPort: PUERTOS.web })],
      healthCheck: { path: '/login' },
      deregistrationDelay: Duration.seconds(30),
    };
    const destinoGateway = {
      port: PUERTOS.gateway,
      protocol: ApplicationProtocol.HTTP,
      targets: [gateway.loadBalancerTarget({ containerName: 'gateway', containerPort: PUERTOS.gateway })],
      healthCheck: { path: '/salud' },
      deregistrationDelay: Duration.seconds(30),
      priority: 10,
      conditions: [ListenerCondition.pathPatterns(['/api/*'])],
    };
    if (props.certificadoArn) {
      const listener = alb.addListener('Https', {
        port: 443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [ListenerCertificate.fromArn(props.certificadoArn)],
        sslPolicy: SslPolicy.RECOMMENDED_TLS,
        open: false,
      });
      listener.addTargets('Web', destinoWeb);
      listener.addTargets('Gateway', destinoGateway);
      alb.addListener('Http', {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        open: false,
        defaultAction: ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
    } else {
      const listener = alb.addListener('Http', { port: 80, protocol: ApplicationProtocol.HTTP, open: false });
      listener.addTargets('Web', destinoWeb);
      listener.addTargets('Gateway', destinoGateway);
    }
  }
}
