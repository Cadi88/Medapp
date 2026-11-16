import { GenericContainer, Wait } from 'testcontainers';

export interface CorreoRecibido {
  para: string;
  asunto: string;
  html: string;
}

export interface TestMailpit {
  /** SMTP al que apunta el servicio bajo prueba. */
  smtpHost: string;
  smtpPort: number;
  /** Todos los mensajes recibidos (con su HTML). */
  mensajes(): Promise<CorreoRecibido[]>;
  stop(): Promise<void>;
}

interface ResumenMensaje {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Mailpit efímero (buzón SMTP de pruebas; misma imagen que docker-compose.yml). SMTP 1025, API HTTP 8025. */
export async function startMailpit(): Promise<TestMailpit> {
  const container = await new GenericContainer('axllent/mailpit')
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp('/api/v1/info', 8025).forStatusCode(200))
    .start();
  const api = `http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1`;
  const json = async <T>(ruta: string): Promise<T> => {
    const res = await fetch(api + ruta);
    if (!res.ok) throw new Error(`Mailpit ${ruta} respondió ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(1025),
    mensajes: async () => {
      const { messages } = await json<{ messages: ResumenMensaje[] }>('/messages?limit=500');
      return Promise.all(
        messages.map(async (m) => ({
          para: m.To[0]?.Address ?? '',
          asunto: m.Subject,
          html: (await json<{ HTML: string }>(`/message/${m.ID}`)).HTML,
        })),
      );
    },
    stop: async () => {
      await container.stop();
    },
  };
}
