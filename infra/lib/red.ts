import { Stack, type StackProps } from 'aws-cdk-lib';
import { IpAddresses, Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import type { Construct } from 'constructs';

/** CIDR de la VPC; el gateway lo recibe como CONFIAR_EN_PROXY (el ALB vive en las subredes públicas de esta VPC). */
export const CIDR_VPC = '10.0.0.0/16';
/** Zonas de disponibilidad explícitas: evita la consulta de contexto a AWS (`cdk synth` no necesita credenciales). */
export const ZONAS = ['mx-central-1a', 'mx-central-1b'];
export const PUERTOS = { gateway: 8080, identidad: 3001, auditoria: 3003, agenda: 3004, web: 3000, nats: 4222 } as const;

/**
 * Red: VPC de 2 AZ (subredes públicas y privadas, 1 NAT), espacio de nombres DNS privado y todos los
 * grupos de seguridad de los servicios. Se definen aquí, junto con sus reglas, para que las demás stacks
 * solo consuman referencias (sin dependencias cíclicas) y el aislamiento quede en un solo lugar:
 *   internet -> balanceador -> {web (/), gateway (/api/*)}; web -> gateway -> {svc-identidad, svc-auditoria, svc-agenda};
 *   auditoría y agenda -> gateway (JWKS).
 */
export class RedStack extends Stack {
  readonly vpc: Vpc;
  readonly namespace: PrivateDnsNamespace;
  readonly sgBalanceador: SecurityGroup;
  readonly sgGateway: SecurityGroup;
  readonly sgIdentidad: SecurityGroup;
  readonly sgAuditoria: SecurityGroup;
  readonly sgAgenda: SecurityGroup;
  readonly sgWeb: SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new Vpc(this, 'Vpc', {
      ipAddresses: IpAddresses.cidr(CIDR_VPC),
      availabilityZones: ZONAS,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'publica', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'privada', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    this.namespace = new PrivateDnsNamespace(this, 'Namespace', {
      name: 'consultorio.local',
      vpc: this.vpc,
      description: 'DNS interno: NATS y Service Connect',
    });

    const crearSg = (id: string, descripcion: string) =>
      new SecurityGroup(this, id, { vpc: this.vpc, description: descripcion, allowAllOutbound: true });

    this.sgBalanceador = crearSg('SgBalanceador', 'Grupo de seguridad del balanceador');
    this.sgGateway = crearSg('SgGateway', 'Grupo de seguridad del gateway');
    this.sgIdentidad = crearSg('SgIdentidad', 'Grupo de seguridad de svc-identidad');
    this.sgAuditoria = crearSg('SgAuditoria', 'Grupo de seguridad de svc-auditoria');
    this.sgAgenda = crearSg('SgAgenda', 'Grupo de seguridad de svc-agenda');
    this.sgWeb = crearSg('SgWeb', 'Grupo de seguridad de web');

    // Único punto de entrada desde internet.
    this.sgBalanceador.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'HTTP (redirige a HTTPS si hay certificado)');
    this.sgBalanceador.addIngressRule(Peer.anyIpv4(), Port.tcp(443), 'HTTPS');

    this.sgGateway.addIngressRule(this.sgBalanceador, Port.tcp(PUERTOS.gateway), 'Balanceador (/api/*)');
    this.sgWeb.addIngressRule(this.sgBalanceador, Port.tcp(PUERTOS.web), 'Balanceador (/)');
    // El sitio web llama al gateway con las cookies y el token del usuario (Service Connect: http://gateway:8080).
    this.sgGateway.addIngressRule(this.sgWeb, Port.tcp(PUERTOS.gateway), 'Sitio web');
    // svc-auditoria y svc-agenda validan tokens con el JWKS que publica el gateway (/api/identidad/.well-known/jwks.json),
    // así identidad no necesita aceptar tráfico de nadie más que del gateway.
    this.sgGateway.addIngressRule(this.sgAuditoria, Port.tcp(PUERTOS.gateway), 'JWKS de svc-auditoria vía gateway');
    this.sgGateway.addIngressRule(this.sgAgenda, Port.tcp(PUERTOS.gateway), 'JWKS de svc-agenda vía gateway');

    // Los servicios internos solo aceptan al gateway (identidad confía en X-Forwarded-For que fija el gateway).
    this.sgIdentidad.addIngressRule(this.sgGateway, Port.tcp(PUERTOS.identidad), 'Gateway');
    this.sgAuditoria.addIngressRule(this.sgGateway, Port.tcp(PUERTOS.auditoria), 'Gateway');
    this.sgAgenda.addIngressRule(this.sgGateway, Port.tcp(PUERTOS.agenda), 'Gateway');
  }
}
