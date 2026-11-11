/**
 * Infraestructura de Consultorio en AWS (mx-central-1). SOLO CÓDIGO: no hay nada desplegado.
 * `cdk bootstrap` y `cdk deploy` crean recursos que cuestan dinero; no ejecutarlos sin leer el README (sección Infraestructura).
 * `cdk synth` y las pruebas (`pnpm --filter @consultorio/infra test`) son locales y gratuitas.
 *
 * Costo mensual estimado si se desplegara (USD, precios de lista aproximados, uso bajo; sin impuestos ni tráfico alto):
 *   RDS PostgreSQL db.t4g.medium, 1 AZ, 50 GB gp3 + 35 días de respaldos ..... ~ 75
 *   NAT Gateway (1) + datos procesados ....................................... ~ 35
 *   Application Load Balancer ................................................ ~ 20
 *   Fargate: gateway 0.25 vCPU/0.5 GB, auditoría 0.25/0.5, identidad 0.5/1, NATS 0.25/0.5 ... ~ 55
 *   EFS (JetStream, pocos GB) + CloudWatch Logs + ECR ........................ ~ 10
 *   KMS (1 llave) + Secrets Manager (7 secretos) + S3 ........................ ~ 10
 *   Total orientativo ........................................................ ~ 205 USD/mes
 * Con RDS Multi-AZ y 2 réplicas por servicio el total ronda 350-400 USD/mes.
 *
 * Contexto opcional (cdk.json o `-c clave=valor`):
 *   certificadoArn  ARN de un certificado ACM de mx-central-1 para el listener HTTPS (sin él: HTTP:80, solo pruebas).
 *   urlPublica      origen público de la API para BETTER_AUTH_URL (por defecto, el DNS del balanceador).
 */
import { crearApp } from '../lib/aplicacion.js';

crearApp().app.synth();
