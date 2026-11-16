import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { crearApp } from '../lib/aplicacion.js';

type Json = Record<string, unknown>;
interface Regla {
  destino: string;
  origen: string;
  cidr?: unknown;
}

const sinCertificado = crearApp();
const conCertificado = crearApp({ certificadoArn: 'arn:aws:acm:mx-central-1:111111111111:certificate/prueba' });
const { stacks } = sinCertificado;
const red = Template.fromStack(stacks.red);
const datos = Template.fromStack(stacks.datos);
const mensajeria = Template.fromStack(stacks.mensajeria);
const servicios = Template.fromStack(stacks.servicios);
const todas = [red, datos, mensajeria, servicios];

/** Mapa nombre de export -> id lógico del recurso exportado (para resolver referencias entre stacks). */
function idsExportados(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const t of todas) {
    for (const salida of Object.values(t.toJSON().Outputs ?? {}) as Json[]) {
      const exp = (salida.Export as Json | undefined)?.Name;
      const valor = salida.Value as Json;
      const getAtt = valor['Fn::GetAtt'] as string[] | undefined;
      const ref = valor.Ref as string | undefined;
      if (typeof exp === 'string') mapa.set(exp, getAtt?.[0] ?? ref ?? '');
    }
  }
  return mapa;
}
const exportados = idsExportados();

function idLogico(valor: unknown): string {
  const v = valor as Json | undefined;
  if (!v) return '';
  if (typeof v.Ref === 'string') return v.Ref;
  if (Array.isArray(v['Fn::GetAtt'])) return v['Fn::GetAtt'][0] as string;
  if (typeof v['Fn::ImportValue'] === 'string') return exportados.get(v['Fn::ImportValue']) ?? '';
  return '';
}

function idDeGrupo(t: Template, descripcion: string): string {
  const ids = Object.keys(t.findResources('AWS::EC2::SecurityGroup', { Properties: { GroupDescription: descripcion } }));
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

/** Todas las reglas de entrada (recursos sueltos y en línea) de todas las stacks, con destino y origen normalizados. */
function reglasDeEntrada(): Regla[] {
  const reglas: Regla[] = [];
  for (const t of todas) {
    for (const r of Object.values(t.findResources('AWS::EC2::SecurityGroupIngress')) as Json[]) {
      const p = r.Properties as Json;
      reglas.push({ destino: idLogico(p.GroupId), origen: idLogico(p.SourceSecurityGroupId), cidr: p.CidrIp });
    }
    for (const [id, g] of Object.entries(t.findResources('AWS::EC2::SecurityGroup'))) {
      for (const i of ((g.Properties as Json).SecurityGroupIngress as Json[] | undefined) ?? []) {
        reglas.push({ destino: id, origen: idLogico(i.SourceSecurityGroupId), cidr: i.CidrIp });
      }
    }
  }
  return reglas;
}

function definicionesDeTarea(): Json[] {
  return Object.values(servicios.findResources('AWS::ECS::TaskDefinition')) as Json[];
}
function contenedor(def: Json): Json {
  return ((def.Properties as Json).ContainerDefinitions as Json[])[0]!;
}
function tareaDe(texto: string): Json {
  const def = definicionesDeTarea().find((d) => contenedor(d).Name === texto);
  expect(def).toBeDefined();
  return def!;
}
const NOMBRES_SERVICIOS = ['gateway', 'svc-identidad', 'svc-auditoria', 'svc-agenda', 'svc-notificaciones', 'web'];
const nombres = (lista: unknown): string[] => ((lista as { Name: string }[] | undefined) ?? []).map((e) => e.Name);

describe('región y entorno', () => {
  test('todas las stacks en mx-central-1', () => {
    for (const s of Object.values(stacks)) expect(s.region).toBe('mx-central-1');
  });
  test('la síntesis funciona sin CDK_DEFAULT_ACCOUNT (sin consultas de contexto a AWS)', () => {
    const previa = process.env.CDK_DEFAULT_ACCOUNT;
    delete process.env.CDK_DEFAULT_ACCOUNT;
    try {
      const { app, stacks: s } = crearApp();
      expect(s.servicios.account).not.toMatch(/^d{12}$/);
      expect(app.synth().manifest.missing ?? []).toHaveLength(0);
    } finally {
      if (previa !== undefined) process.env.CDK_DEFAULT_ACCOUNT = previa;
    }
  });
});

describe('RedStack', () => {
  test('VPC con 2 subredes públicas, 2 privadas y 1 NAT', () => {
    red.resourceCountIs('AWS::EC2::VPC', 1);
    red.resourceCountIs('AWS::EC2::Subnet', 4);
    red.resourceCountIs('AWS::EC2::NatGateway', 1);
    red.resourcePropertiesCountIs('AWS::EC2::Subnet', { MapPublicIpOnLaunch: true }, 2);
  });
});

describe('DatosStack', () => {
  test('RDS Postgres 16 cifrado, con PITR de 35 días y protección de borrado', () => {
    datos.hasResourceProperties(
      'AWS::RDS::DBInstance',
      Match.objectLike({
        Engine: 'postgres',
        EngineVersion: Match.stringLikeRegexp('^16'),
        DBInstanceClass: 'db.t4g.medium',
        StorageEncrypted: true,
        KmsKeyId: Match.anyValue(),
        BackupRetentionPeriod: 35,
        DeletionProtection: true,
        PubliclyAccessible: false,
      }),
    );
  });
  test('S3 cifrado con KMS, sin acceso público y versionado', () => {
    datos.hasResourceProperties(
      'AWS::S3::Bucket',
      Match.objectLike({
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }) }),
          ],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
  });
  test('llave KMS con rotación', () => {
    datos.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });
  test('la base solo acepta tráfico de los SG de los servicios con base de datos', () => {
    const permitidos = [
      idDeGrupo(red, 'Grupo de seguridad de svc-identidad'),
      idDeGrupo(red, 'Grupo de seguridad de svc-auditoria'),
      idDeGrupo(red, 'Grupo de seguridad de svc-agenda'),
      idDeGrupo(red, 'Grupo de seguridad de svc-notificaciones'),
    ];
    const bd = idDeGrupo(datos, 'Grupo de seguridad de la base de datos');
    const reglas = reglasDeEntrada().filter((r) => r.destino === bd);
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      expect(r.cidr).toBeUndefined();
      expect(permitidos).toContain(r.origen);
    }
  });
});

describe('MensajeriaStack', () => {
  test('NATS con JetStream sobre Fargate y EFS cifrado', () => {
    mensajeria.hasResourceProperties(
      'AWS::ECS::TaskDefinition',
      Match.objectLike({
        RequiresCompatibilities: ['FARGATE'],
        ContainerDefinitions: [Match.objectLike({ Image: 'nats:2', Command: Match.arrayWith(['-js']) })],
        Volumes: [Match.objectLike({ EFSVolumeConfiguration: Match.objectLike({ TransitEncryption: 'ENABLED' }) })],
      }),
    );
    mensajeria.hasResourceProperties('AWS::EFS::FileSystem', { Encrypted: true });
  });
  test('el SG de NATS solo admite ingreso desde los SG de los servicios', () => {
    const nats = idDeGrupo(mensajeria, 'Grupo de seguridad de NATS');
    const permitidos = [
      idDeGrupo(red, 'Grupo de seguridad de svc-identidad'),
      idDeGrupo(red, 'Grupo de seguridad de svc-auditoria'),
      idDeGrupo(red, 'Grupo de seguridad de svc-agenda'),
      idDeGrupo(red, 'Grupo de seguridad de svc-notificaciones'),
    ];
    const reglas = reglasDeEntrada().filter((r) => r.destino === nats);
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      expect(r.cidr).toBeUndefined();
      expect(permitidos).toContain(r.origen);
    }
  });
  test('el EFS solo admite ingreso desde el SG de NATS', () => {
    const nats = idDeGrupo(mensajeria, 'Grupo de seguridad de NATS');
    const efs = idDeGrupo(mensajeria, 'Grupo de seguridad del EFS de NATS');
    const reglas = reglasDeEntrada().filter((r) => r.destino === efs);
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) expect(r.origen).toBe(nats);
  });
  test('NATS sin IP pública', () => {
    mensajeria.resourcePropertiesCountIs(
      'AWS::ECS::Service',
      { NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }) } },
      0,
    );
  });
});

describe('ServiciosStack', () => {
  test('solo el balanceador es público: 6 servicios ECS y un único balanceador', () => {
    servicios.resourceCountIs('AWS::ECS::Service', 6);
    servicios.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    servicios.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internet-facing' });
    servicios.resourcePropertiesCountIs(
      'AWS::ECS::Service',
      { NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }) } },
      0,
    );
  });
  test('servicios ECS con los nombres exactos que usa el CI', () => {
    for (const ServiceName of NOMBRES_SERVICIOS) {
      servicios.hasResourceProperties('AWS::ECS::Service', { ServiceName, LaunchType: 'FARGATE' });
    }
    servicios.hasResourceProperties('AWS::ECS::Cluster', { ClusterName: 'consultorio' });
  });
  test('seis repositorios ECR con etiquetas inmutables, escaneo al subir y ciclo de vida de 20 imágenes', () => {
    servicios.resourceCountIs('AWS::ECR::Repository', 6);
    for (const RepositoryName of NOMBRES_SERVICIOS.map((n) => `consultorio/${n}`)) {
      servicios.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName,
        ImageTagMutability: 'IMMUTABLE',
        ImageScanningConfiguration: { ScanOnPush: true },
        LifecyclePolicy: { LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":20') },
      });
    }
  });
  test('las definiciones de tarea nunca usan :latest; sin imageTag la etiqueta es el parámetro ImageTag (obligatorio al desplegar)', () => {
    expect(definicionesDeTarea()).toHaveLength(6);
    for (const d of definicionesDeTarea()) {
      const imagen = JSON.stringify(contenedor(d).Image);
      expect(imagen).not.toMatch(/latest/);
      expect(imagen).toContain('{"Ref":"ImageTag"}');
    }
    const parametro = (servicios.toJSON().Parameters as Json)['ImageTag'] as Json;
    expect(parametro).toMatchObject({ Type: 'String' });
    expect(parametro.Default).toBeUndefined();
  });
  test('con imageTag (opción o contexto -c imageTag=<sha>) las tareas usan :<sha> y no hay parámetro', () => {
    const conTag = Template.fromStack(crearApp({ imageTag: '0123abcd' }).stacks.servicios);
    const defs = Object.values(conTag.findResources('AWS::ECS::TaskDefinition')) as Json[];
    expect(defs).toHaveLength(6);
    for (const d of defs) expect(JSON.stringify(contenedor(d).Image)).toMatch(/:0123abcd"/);
    expect((conTag.toJSON().Parameters as Json | undefined)?.['ImageTag']).toBeUndefined();
  });
  test.each(['latest', 'con espacios', '', 'a/b'])('imageTag inválido %j → error', (tag) => {
    expect(() => crearApp({ imageTag: tag })).toThrow(/imageTag/);
  });
  test('health check del contenedor y del balanceador: /salud en los servicios y /login en web', () => {
    for (const d of definicionesDeTarea()) {
      const ruta = contenedor(d).Name === 'web' ? '/login' : '/salud';
      expect(JSON.stringify(contenedor(d).HealthCheck)).toContain(ruta);
    }
    servicios.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', Match.objectLike({ HealthCheckPath: '/salud' }));
    servicios.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', Match.objectLike({ HealthCheckPath: '/login', Port: 3000 }));
  });
  test('logs a CloudWatch y Service Connect en los seis servicios', () => {
    servicios.resourceCountIs('AWS::Logs::LogGroup', 6);
    servicios.resourcePropertiesCountIs('AWS::ECS::Service', { ServiceConnectConfiguration: Match.objectLike({ Enabled: true }) }, 6);
  });
  test('svc-agenda: puerto 3004, JWKS por el gateway, secretos de agenda_db en la misma instancia', () => {
    const def = contenedor(tareaDe('svc-agenda'));
    const env = def.Environment as { Name: string; Value: unknown }[];
    const valor = (n: string) => env.find((e) => e.Name === n)?.Value;
    expect(valor('PORT')).toBe('3004');
    expect(valor('JWKS_URL')).toBe('http://gateway:8080/api/identidad/.well-known/jwks.json');
    expect(nombres(def.Secrets)).toEqual(expect.arrayContaining(['DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'TOKEN_INTERNO']));
    for (const n of nombres(def.Secrets)) expect(nombres(def.Environment)).not.toContain(n);
    for (const Name of ['consultorio/agenda_app', 'consultorio/agenda_migrator']) {
      servicios.hasResourceProperties('AWS::SecretsManager::Secret', Match.objectLike({ Name, KmsKeyId: Match.anyValue() }));
    }
    // El host de RDS es un token (Fn::Join): se busca la base en el JSON serializado de cada secreto.
    const conAgendaDb = Object.values(servicios.findResources('AWS::SecretsManager::Secret')).filter((x) =>
      JSON.stringify((x.Properties as Json).GenerateSecretString).includes('agenda_db'),
    );
    expect(conAgendaDb).toHaveLength(2);
  });
  test('svc-identidad: S3_BUCKET/S3_REGION y rol con Get/Put/Delete solo sobre logos/* (sin endpoint ni llaves)', () => {
    const env = contenedor(tareaDe('svc-identidad')).Environment as { Name: string; Value: unknown }[];
    const valor = (n: string) => env.find((e) => e.Name === n)?.Value;
    expect(JSON.stringify(valor('S3_BUCKET'))).toContain('Archivos'); // referencia al bucket Archivos de DatosStack
    expect(valor('S3_REGION')).toBe('mx-central-1');
    const nombresEnv = env.map((e) => e.Name);
    for (const n of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) expect(nombresEnv).not.toContain(n);

    const sentencias = Object.values(servicios.findResources('AWS::IAM::Policy')).flatMap((p) => {
      const doc = (p.Properties as Json).PolicyDocument as { Statement: Json[] };
      return doc.Statement;
    });
    const deS3 = sentencias.filter((st) => JSON.stringify(st.Action).includes('s3:'));
    expect(deS3).toHaveLength(2);
    const accionesDe = (st: Json) => ([] as string[]).concat(st.Action as string | string[]).sort();
    const deIdentidad = deS3.find((st) => accionesDe(st).length === 3)!;
    expect(accionesDe(deIdentidad)).toEqual(['s3:DeleteObject', 's3:GetObject', 's3:PutObject']);
    for (const st of deS3) {
      const recurso = JSON.stringify(st.Resource);
      expect(recurso).toContain('/logos/*');
      expect(recurso).not.toContain('"*"');
    }
    // El bucket va cifrado con KMS: sin estos permisos sobre la llave, guardar el logo fallaría.
    const deKms = sentencias.filter((st) => JSON.stringify(st.Action).includes('kms:GenerateDataKey'));
    expect(deKms.length).toBeGreaterThan(0);
  });
  test('svc-notificaciones: puerto 3005, solo lectura de logos/*, TOKEN_INTERNO y SMTP como secretos', () => {
    const def = contenedor(tareaDe('svc-notificaciones'));
    const env = def.Environment as { Name: string; Value: unknown }[];
    const valor = (n: string) => env.find((e) => e.Name === n)?.Value;
    expect(valor('PORT')).toBe('3005');
    expect(valor('JWKS_URL')).toBe('http://gateway:8080/api/identidad/.well-known/jwks.json');
    expect(valor('AGENDA_URL')).toBe('http://svc-agenda:3004');
    expect(valor('IDENTIDAD_URL')).toBe('http://svc-identidad:3001');
    expect(valor('NATS_URL')).toBeDefined();
    expect(valor('WEB_ORIGEN')).toBeDefined();
    expect(JSON.stringify(valor('S3_BUCKET'))).toContain('Archivos');
    expect(valor('S3_REGION')).toBe('mx-central-1');
    for (const n of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) expect(env.map((e) => e.Name)).not.toContain(n);
    expect(nombres(def.Secrets)).toEqual(
      expect.arrayContaining([
        'DATABASE_URL',
        'MIGRATOR_DATABASE_URL',
        'TOKEN_INTERNO',
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_REMITENTE',
        'SMTP_USUARIO',
        'SMTP_PASSWORD',
      ]),
    );
    for (const n of nombres(def.Secrets)) expect(nombres(def.Environment)).not.toContain(n);

    // Solo s3:GetObject sobre logos/* y kms:Decrypt: el rol de notificaciones no escribe en el bucket.
    const idRol = idLogico((tareaDe('svc-notificaciones').Properties as Json).TaskRoleArn);
    const sentencias = Object.values(servicios.findResources('AWS::IAM::Policy'))
      .filter((p) => JSON.stringify((p.Properties as Json).Roles).includes(idRol))
      .flatMap((p) => ((p.Properties as Json).PolicyDocument as { Statement: Json[] }).Statement);
    const deS3 = sentencias.filter((st) => JSON.stringify(st.Action).includes('s3:'));
    expect(deS3).toHaveLength(1);
    expect(deS3[0]!.Action).toBe('s3:GetObject');
    expect(JSON.stringify(deS3[0]!.Resource)).toContain('/logos/*');
    const deKms = sentencias.filter((st) => JSON.stringify(st.Action).includes('kms:'));
    expect(deKms).toHaveLength(1);
    expect(deKms[0]!.Action).toBe('kms:Decrypt');
  });
  test('TOKEN_INTERNO es un solo secreto de Secrets Manager que comparten agenda, identidad y notificaciones', () => {
    const referencias = ['svc-agenda', 'svc-identidad', 'svc-notificaciones'].map((n) => {
      const s = (contenedor(tareaDe(n)).Secrets as { Name: string; ValueFrom: unknown }[]).find((x) => x.Name === 'TOKEN_INTERNO');
      expect(s).toBeDefined();
      return JSON.stringify(s!.ValueFrom);
    });
    expect(new Set(referencias).size).toBe(1);
    // El gateway y web no lo necesitan: el gateway responde 404 a /interno/*.
    for (const n of ['gateway', 'web']) expect(nombres(contenedor(tareaDe(n)).Secrets)).not.toContain('TOKEN_INTERNO');
    const conTokenInterno = Object.values(servicios.findResources('AWS::SecretsManager::Secret')).filter(
      (x) => (x.Properties as Json).Name === 'consultorio/token-interno',
    );
    expect(conTokenInterno).toHaveLength(1);
  });
  test('notificaciones_db y sus roles quedan documentados como las demás bases', () => {
    const texto = readFileSync(new URL('../lib/datos.ts', import.meta.url), 'utf8');
    expect(texto).toMatch(/notificaciones_db/);
    expect(texto).toMatch(/notificaciones_migrator/);
  });
  test('web: puerto 3000, habla con el gateway por Service Connect y no lleva secretos', () => {
    const def = contenedor(tareaDe('web'));
    const env = def.Environment as { Name: string; Value: unknown }[];
    const valor = (n: string) => env.find((e) => e.Name === n)?.Value;
    expect(valor('PORT')).toBe('3000');
    expect(valor('GATEWAY_URL')).toBe('http://gateway:8080');
    expect(valor('COOKIE_SEGURA')).toBe('false'); // sin certificado: HTTP
    expect(valor('WEB_ORIGEN')).toBeDefined();
    expect(def.Secrets ?? []).toEqual([]);
  });
  test('con certificado, las cookies de web son seguras y su origen es la URL pública', () => {
    const https = Template.fromStack(
      crearApp({ certificadoArn: 'arn:aws:acm:mx-central-1:111111111111:certificate/prueba', urlPublica: 'https://app.ejemplo.mx' }).stacks.servicios,
    );
    const def = (Object.values(https.findResources('AWS::ECS::TaskDefinition')) as Json[]).find((d) => contenedor(d).Name === 'web')!;
    const env = contenedor(def).Environment as { Name: string; Value: unknown }[];
    expect(env).toEqual(expect.arrayContaining([{ Name: 'COOKIE_SEGURA', Value: 'true' }, { Name: 'WEB_ORIGEN', Value: 'https://app.ejemplo.mx' }]));
  });
  test('el balanceador enruta / a web (acción por omisión) y /api/* al gateway', () => {
    const grupos = servicios.findResources('AWS::ElasticLoadBalancingV2::TargetGroup') as Record<string, Json>;
    const idGrupo = (puerto: number) => Object.keys(grupos).find((id) => (grupos[id]!.Properties as Json).Port === puerto)!;
    const web = idGrupo(3000);
    const gateway = idGrupo(8080);
    expect(web).toBeDefined();
    expect(gateway).toBeDefined();
    const [listener] = Object.values(servicios.findResources('AWS::ElasticLoadBalancingV2::Listener', { Properties: { Port: 80 } })) as Json[];
    const porOmision = (listener!.Properties as Json).DefaultActions as Json[];
    expect(porOmision).toHaveLength(1);
    expect(idLogico(porOmision[0]!.TargetGroupArn)).toBe(web);
    servicios.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::ListenerRule',
      Match.objectLike({
        Conditions: [Match.objectLike({ Field: 'path-pattern', PathPatternConfig: { Values: ['/api/*'] } })],
        Actions: [Match.objectLike({ Type: 'forward', TargetGroupArn: { Ref: gateway } })],
      }),
    );
  });
  test('con certificado, HTTPS lleva la misma regla /api/* y HTTP solo redirige', () => {
    const https = Template.fromStack(conCertificado.stacks.servicios);
    https.resourceCountIs('AWS::ElasticLoadBalancingV2::ListenerRule', 1);
    https.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::ListenerRule',
      Match.objectLike({ Conditions: [Match.objectLike({ PathPatternConfig: { Values: ['/api/*'] } })] }),
    );
  });
  test('la estimación de costo de bin/app.ts incluye svc-agenda, svc-notificaciones y web', () => {
    const texto = readFileSync(new URL('../bin/app.ts', import.meta.url), 'utf8');
    expect(texto).toMatch(/svc-agenda/);
    expect(texto).toMatch(/\bweb\b/);
    expect(texto).toMatch(/svc-notificaciones/);
    expect(texto).toMatch(/Secrets Manager \(12 secretos\)/);
  });
  test('gateway: CONFIAR_EN_PROXY es el CIDR de la VPC y apunta a los servicios por Service Connect', () => {
    const env = contenedor(tareaDe('gateway')).Environment as { Name: string; Value: unknown }[];
    const valor = (n: string) => env.find((e) => e.Name === n)?.Value;
    expect(valor('CONFIAR_EN_PROXY')).toBe('10.0.0.0/16');
    expect(valor('PORT')).toBe('8080');
    expect(valor('IDENTIDAD_URL')).toBe('http://svc-identidad:3001');
    expect(valor('AUDITORIA_URL')).toBe('http://svc-auditoria:3003');
    expect(valor('AGENDA_URL')).toBe('http://svc-agenda:3004');
    expect(valor('NOTIFICACIONES_URL')).toBe('http://svc-notificaciones:3005');
    expect(valor('JWKS_URL')).toBe('http://svc-identidad:3001/.well-known/jwks.json');
  });
  test('secretos de BD, JWT y Better Auth inyectados como Secrets, nunca como Environment', () => {
    const identidad = contenedor(tareaDe('svc-identidad'));
    expect(nombres(identidad.Secrets)).toEqual(
      expect.arrayContaining(['JWT_PRIVATE_JWK', 'BETTER_AUTH_SECRET', 'DATABASE_URL', 'MIGRATOR_DATABASE_URL', 'TOKEN_INTERNO']),
    );
    for (const n of nombres(identidad.Secrets)) expect(nombres(identidad.Environment)).not.toContain(n);

    const auditoria = contenedor(tareaDe('svc-auditoria'));
    expect(nombres(auditoria.Secrets)).toEqual(expect.arrayContaining(['DATABASE_URL', 'MIGRATOR_DATABASE_URL']));
    for (const n of nombres(auditoria.Secrets)) expect(nombres(auditoria.Environment)).not.toContain(n);

    // Ninguna contraseña ni llave aparece en texto plano en las definiciones de tarea.
    expect(nombres(contenedor(tareaDe('gateway')).Secrets)).toEqual([]);
  });
  test('secretos en Secrets Manager con valores generados y cifrados con la llave KMS', () => {
    for (const Name of [
      'consultorio/identidad_app',
      'consultorio/identidad_migrator',
      'consultorio/auditoria_app',
      'consultorio/auditoria_migrator',
      'consultorio/notificaciones_app',
      'consultorio/notificaciones_migrator',
      'consultorio/token-interno',
      'consultorio/smtp',
      'consultorio/better-auth-secret',
      'consultorio/jwt-private-jwk',
    ]) {
      servicios.hasResourceProperties('AWS::SecretsManager::Secret', Match.objectLike({ Name, KmsKeyId: Match.anyValue() }));
    }
  });
  test('NODE_ENV=production en los seis servicios', () => {
    for (const d of definicionesDeTarea()) {
      expect(contenedor(d).Environment).toEqual(expect.arrayContaining([{ Name: 'NODE_ENV', Value: 'production' }]));
    }
  });
  test('sin certificado: listener HTTP; con certificado: HTTPS y HTTP redirige', () => {
    servicios.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Port: 80, Protocol: 'HTTP' });
    servicios.resourcePropertiesCountIs('AWS::ElasticLoadBalancingV2::Listener', { Protocol: 'HTTPS' }, 0);
    const https = Template.fromStack(conCertificado.stacks.servicios);
    https.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::Listener',
      Match.objectLike({ Port: 443, Protocol: 'HTTPS', Certificates: Match.anyValue() }),
    );
    https.hasResourceProperties(
      'AWS::ElasticLoadBalancingV2::Listener',
      Match.objectLike({ Port: 80, DefaultActions: [Match.objectLike({ Type: 'redirect' })] }),
    );
  });
});

describe('aislamiento de red', () => {
  const gateway = () => idDeGrupo(red, 'Grupo de seguridad del gateway');
  const alb = () => idDeGrupo(red, 'Grupo de seguridad del balanceador');

  test('svc-identidad, svc-auditoria y svc-agenda solo admiten ingreso desde el SG del gateway', () => {
    for (const desc of [
      'Grupo de seguridad de svc-identidad',
      'Grupo de seguridad de svc-auditoria',
      'Grupo de seguridad de svc-agenda',
      'Grupo de seguridad de svc-notificaciones',
    ]) {
      const id = idDeGrupo(red, desc);
      const reglas = reglasDeEntrada().filter((r) => r.destino === id);
      expect(reglas.length).toBeGreaterThan(0);
      // agenda e identidad atienden además las llamadas /interno/* de notificaciones (con TOKEN_INTERNO).
      const permitidos = [gateway()];
      if (desc.endsWith('svc-agenda') || desc.endsWith('svc-identidad')) permitidos.push(idDeGrupo(red, 'Grupo de seguridad de svc-notificaciones'));
      for (const r of reglas) {
        expect(r.cidr).toBeUndefined();
        expect(permitidos).toContain(r.origen);
      }
    }
  });
  test('notificaciones solo la alcanza el gateway; identidad y agenda aceptan además su llamada interna', () => {
    const notificaciones = idDeGrupo(red, 'Grupo de seguridad de svc-notificaciones');
    const origenes = (destino: string) => reglasDeEntrada().filter((r) => r.destino === destino).map((r) => r.origen);
    expect(origenes(notificaciones)).toEqual([gateway()]);
    expect(origenes(idDeGrupo(red, 'Grupo de seguridad de svc-identidad'))).toContain(notificaciones);
    expect(origenes(idDeGrupo(red, 'Grupo de seguridad de svc-agenda'))).toContain(notificaciones);
    // Nada más tiene permiso de hablar con el servicio de notificaciones: ni web ni el balanceador.
    expect(origenes(idDeGrupo(red, 'Grupo de seguridad de web'))).not.toContain(notificaciones);
  });
  test('el gateway solo admite ingreso desde el balanceador, web y los servicios que leen el JWKS', () => {
    const reglas = reglasDeEntrada().filter((r) => r.destino === gateway());
    expect(reglas.length).toBeGreaterThan(0);
    const permitidos = [
      alb(),
      idDeGrupo(red, 'Grupo de seguridad de web'),
      idDeGrupo(red, 'Grupo de seguridad de svc-auditoria'),
      idDeGrupo(red, 'Grupo de seguridad de svc-agenda'),
      idDeGrupo(red, 'Grupo de seguridad de svc-notificaciones'), // JWKS
    ];
    for (const r of reglas) expect(permitidos).toContain(r.origen);
  });
  test('web solo admite ingreso desde el balanceador', () => {
    const reglas = reglasDeEntrada().filter((r) => r.destino === idDeGrupo(red, 'Grupo de seguridad de web'));
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      expect(r.cidr).toBeUndefined();
      expect(r.origen).toBe(alb());
    }
  });
  test('solo el balanceador admite ingreso desde internet', () => {
    const publicos = reglasDeEntrada().filter((r) => r.cidr === '0.0.0.0/0');
    expect(publicos.length).toBeGreaterThan(0);
    for (const r of publicos) expect(r.destino).toBe(alb());
  });
});
