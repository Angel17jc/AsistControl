export type BiometricErrorCode =
  | 'CONNECTION_FAILED'
  | 'NOT_CONNECTED'
  | 'TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'AUTHENTICATION_FAILED'
  | 'UNSUPPORTED_DRIVER'
  | 'UNSUPPORTED_OPERATION';

/** Base error for every device failure; `retryable` drives the sync retry policy. */
export class BiometricDeviceError extends Error {
  constructor(
    message: string,
    readonly code: BiometricErrorCode,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class DeviceConnectionError extends BiometricDeviceError {
  constructor(message = 'Unable to connect to device') {
    super(message, 'CONNECTION_FAILED', true);
  }
}

export class DeviceNotConnectedError extends BiometricDeviceError {
  constructor(message = 'Device is not connected') {
    super(message, 'NOT_CONNECTED', true);
  }
}

export class DeviceTimeoutError extends BiometricDeviceError {
  constructor(message = 'Device operation timed out') {
    super(message, 'TIMEOUT', true);
  }
}

export class DeviceProtocolError extends BiometricDeviceError {
  constructor(message = 'Unexpected response from device') {
    super(message, 'PROTOCOL_ERROR', false);
  }
}

export class DeviceAuthenticationError extends BiometricDeviceError {
  constructor(message = 'Device rejected the credentials') {
    super(message, 'AUTHENTICATION_FAILED', false);
  }
}

export class UnsupportedDriverError extends BiometricDeviceError {
  constructor(driver: string) {
    super(`No adapter registered for driver "${driver}"`, 'UNSUPPORTED_DRIVER', false);
  }
}

/** Rejects with DeviceTimeoutError if `promise` does not settle within `ms`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DeviceTimeoutError(`${operation} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
