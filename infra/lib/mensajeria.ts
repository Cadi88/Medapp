import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Port, SecurityGroup, SubnetType, type ISecurityGroup, type IVpc } from 'aws-cdk-lib/aws-ec2';
import { Cluster, ContainerImage, FargateService, FargateTaskDefinition, LogDrivers } from 'aws-cdk-lib/aws-ecs';
import { FileSystem, LifecyclePolicy, PerformanceMode, ThroughputMode } from 'aws-cdk-lib/aws-efs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { DnsRecordType, type IPrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import type { Construct } from 'constructs';
import { PUERTOS } from './red.js';

export interface MensajeriaStackProps extends StackProps {
  vpc: IVpc;
  namespace: IPrivateDnsNamespace;
  /** Servicios que publican/consumen eventos: los únicos que pueden llegar a NATS. */
  sgClientes: ISecurityGroup[];
}

/**
 * Mensajería: NATS con JetStream en Fargate (una tarea) con los streams en un volumen EFS cifrado.
 * Solo accesible desde la VPC: subred privada, sin IP pública y SG que admite únicamente a los servicios.
 * Se resuelve por DNS interno como `nats.consultorio.local` (NATS_URL = nats://nats.consultorio.local:4222).
 *
 * Tiene su propio clúster ECS (`consultorio-mensajeria`) para que ServiciosStack dependa de esta stack
 * (y no al revés) al recibir la URL de NATS.
 */
export class MensajeriaStack extends Stack {
  readonly cluster: Cluster;
  readonly natsUrl = `nats://nats.consultorio.local:${PUERTOS.nats}`;

  constructor(scope: Construct, id: string, props: MensajeriaStackProps) {
    super(scope, id, props);

    this.cluster = new Cluster(this, 'Cluster', { clusterName: 'consultorio-mensajeria', vpc: props.vpc });

    const sgNats = new SecurityGroup(this, 'SgNats', {
      vpc: props.vpc,
      description: 'Grupo de seguridad de NATS',
      allowAllOutbound: true,
    });
    for (const sg of props.sgClientes) sgNats.addIngressRule(sg, Port.tcp(PUERTOS.nats), 'Cliente NATS');

    const sgEfs = new SecurityGroup(this, 'SgEfs', {
      vpc: props.vpc,
      description: 'Grupo de seguridad del EFS de NATS',
      allowAllOutbound: false,
    });
    sgEfs.addIngressRule(sgNats, Port.tcp(2049), 'NFS desde NATS');

    const sistemaDeArchivos = new FileSystem(this, 'Jetstream', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: sgEfs,
      encrypted: true,
      performanceMode: PerformanceMode.GENERAL_PURPOSE,
      throughputMode: ThroughputMode.BURSTING,
      lifecyclePolicy: LifecyclePolicy.AFTER_30_DAYS,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const tarea = new FargateTaskDefinition(this, 'Tarea', { cpu: 256, memoryLimitMiB: 512 });
    tarea.addVolume({
      name: 'jetstream',
      efsVolumeConfiguration: {
        fileSystemId: sistemaDeArchivos.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: { iam: 'ENABLED' },
      },
    });
    sistemaDeArchivos.grantRootAccess(tarea.taskRole);

    const contenedor = tarea.addContainer('nats', {
      image: ContainerImage.fromRegistry('nats:2'),
      // -js activa JetStream; -sd lo guarda en el volumen EFS; -m abre el monitoreo en 8222.
      command: ['-js', '-sd', '/data', '-m', '8222'],
      logging: LogDrivers.awsLogs({ streamPrefix: 'nats', logRetention: RetentionDays.ONE_MONTH }),
    });
    contenedor.addPortMappings({ containerPort: PUERTOS.nats });
    contenedor.addMountPoints({ containerPath: '/data', sourceVolume: 'jetstream', readOnly: false });

    new FargateService(this, 'Nats', {
      serviceName: 'nats',
      cluster: this.cluster,
      taskDefinition: tarea,
      desiredCount: 1,
      // Una sola réplica con almacenamiento compartido: nunca dos tareas a la vez sobre el mismo JetStream.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      securityGroups: [sgNats],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      cloudMapOptions: {
        cloudMapNamespace: props.namespace,
        name: 'nats',
        dnsRecordType: DnsRecordType.A,
        dnsTtl: Duration.seconds(10),
      },
    });
  }
}
