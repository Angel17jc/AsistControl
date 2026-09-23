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
  credentials: CredentialField[];
  /** The driver speaks HTTP and can use HTTPS instead. */
  httpTransport: boolean;
}

const PRESETS: Record<DeviceDriver, DriverPreset> = {
  MOCK: {
    manufacturer: 'AsistControl',
    model: 'AC-SIM-100',
    port: 4370,
    credentials: [],
    httpTransport: false,
  },
  ZKTECO: {
    manufacturer: 'ZKTeco',
    model: 'K40',
    port: 4370,
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
    credentials: [
      {
        key: 'username',
        label: 'Usuario ISAPI',
        secret: false,
        required: true,
        hint: 'Mejor un usuario dedicado que el administrador del equipo',
      },
      { key: 'password', label: 'Contraseña ISAPI', secret: true, required: true },
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
