import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize, InstanceType, Port, SecurityGroup, SubnetType, type ISecurityGroup, type IVpc } from 'aws-cdk-lib/aws-ec2';
import { Key } from 'aws-cdk-lib/aws-kms';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface DatosStackProps extends StackProps {
  vpc: IVpc;
  /** Servicios con base de datos: los únicos que pueden conectarse a RDS. */
  sgClientes: ISecurityGroup[];
}

/**
 * Datos: llave KMS, RDS PostgreSQL 16 (privado, cifrado, 35 días de respaldo/PITR, protegido contra borrado)
 * y bucket S3 cifrado con KMS.
 *
 * Arranque manual (una sola vez, por quien despliegue): CDK solo crea la instancia con su usuario maestro.
 * Hay que conectarse a ella y crear las bases y roles como en `docker/postgres/init.sql`
 * (`identidad_db`/`auditoria_db`, `<svc>_migrator` dueño, `<svc>_app` NOBYPASSRLS) con las contraseñas generadas
 * en los secretos `consultorio/<rol>` de Secrets Manager (ver ServiciosStack).
 */
export class DatosStack extends Stack {
  readonly clave: Key;
  readonly baseDeDatos: DatabaseInstance;
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: DatosStackProps) {
    super(scope, id, props);

    this.clave = new Key(this, 'Clave', {
      alias: 'consultorio/datos',
      description: 'Cifrado de RDS, S3 y secretos de Consultorio',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const sgBd = new SecurityGroup(this, 'SgBd', {
      vpc: props.vpc,
      description: 'Grupo de seguridad de la base de datos',
      allowAllOutbound: false,
    });
    for (const sg of props.sgClientes) sgBd.addIngressRule(sg, Port.tcp(5432), 'PostgreSQL');

    this.baseDeDatos = new DatabaseInstance(this, 'Postgres', {
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [sgBd],
      publiclyAccessible: false,
      credentials: Credentials.fromGeneratedSecret('consultorio_admin', { encryptionKey: this.clave }),
      storageType: StorageType.GP3,
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      storageEncryptionKey: this.clave,
      backupRetention: Duration.days(35),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      multiAz: false, // subir a true al tener ingresos: duplica el costo de la instancia
      autoMinorVersionUpgrade: true,
    });

    this.bucket = new Bucket(this, 'Archivos', {
      encryption: BucketEncryption.KMS,
      encryptionKey: this.clave,
      bucketKeyEnabled: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
