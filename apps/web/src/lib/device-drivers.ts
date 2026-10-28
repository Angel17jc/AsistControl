import type { DeviceDriver } from '@asistcontrol/shared';

/**
 * What the registration form needs to know about each driver. Presentation only: sensible
 * defaults and the credential fields to ask for. Every rule about devices lives in the API.
 */
export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  hint?: string;
}

export interface DriverPreset {
  manufacturer: string;
  model: string;
  port: number;
  /** Where the port number comes from, in the words of whoever sets the device up. */
  portHint: string;
  credentials: CredentialField[];
  /** The driver speaks HTTP and can use HTTPS instead. */
  httpTransport: boolean;
}

const PRESETS: Record<DeviceDriver, DriverPreset> = {
  MOCK: {
    manufacturer: 'AsistControl',
    model: 'AC-SIM-100',
    port: 4370,
    portHint: 'Cualquiera libre: es un simulador para practicar sin equipo',
    credentials: [],
    httpTransport: false,
  },
  ZKTECO: {
    manufacturer: 'ZKTeco',
    model: 'K40',
    port: 4370,
    portHint: 'Normalmente 4370',
    credentials: [
      {
        key: 'commKey',
        label: 'Clave de comunicación',
        secret: true,
        required: false,
        hint: 'Déjela vacía si el equipo no tiene clave configurada',
      },
    ],
    httpTransport: false,
  },
  HIKVISION: {
    manufacturer: 'Hikvision',
    model: 'DS-K1T671M',
    port: 80,
    portHint: 'Normalmente 80 (HTTP) o 443 (HTTPS). El 8000 es de iVMS-4200 y aquí no sirve',
    credentials: [
      {
        key: 'username',
        label: 'Usuario ISAPI',
        secret: false,
        required: true,
        hint: 'Un usuario del equipo que pueda consultar registros (Log Search), mejor que «admin»',
      },
      {
        key: 'password',
        label: 'Contraseña ISAPI',
        secret: true,
        required: true,
        hint: 'La de ese usuario. Tras varios intentos fallidos el equipo lo bloquea un rato',
      },
    ],
    httpTransport: true,
  },
};

/** Drivers the API offers but this build does not know get a plain form. */
export function driverPreset(driver: string): DriverPreset {
  return (
    PRESETS[driver as DeviceDriver] ?? {
      manufacturer: '',
      model: '',
      port: 4370,
      portHint: '',
      credentials: [],
      httpTransport: false,
    }
  );
}

/**
 * A device failure in words an operator can act on. The API sends `CODE: detail`; the code
 * decides where to look (network, credentials, configuration).
 */
export function explainDeviceError(error: string | null): string {
  if (!error) return 'Error desconocido';
  const [code = '', ...rest] = error.split(': ');
  const detail = rest.join(': ');
  const reason: Record<string, string> = {
    AUTHENTICATION_FAILED: 'El equipo rechazó las credenciales',
    CONNECTION_FAILED: 'Sin respuesta del equipo: revise la IP, el puerto y la red',
    TIMEOUT: 'El equipo no respondió a tiempo',
    PROTOCOL_ERROR: 'El equipo respondió algo inesperado',
    UNSUPPORTED_DRIVER: 'El driver no está disponible en este servidor',
  };
  return reason[code] ? `${reason[code]} (${detail})` : error;
}
