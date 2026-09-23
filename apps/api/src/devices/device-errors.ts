import { BiometricDeviceError } from '@asistcontrol/biometric-core';
import type { DeviceStatus } from '@prisma/client';

/** Message stored on the device and in its sync log: the typed code plus the adapter's text. */
export function describeDeviceError(error: unknown): string {
  if (error instanceof BiometricDeviceError) return `${error.code}: ${error.message}`;
  return 'Unexpected device error';
}

/**
 * Status a failure leaves the device in. A transient failure (network, timeout) means the
 * terminal is OFFLINE; one that retrying cannot fix (wrong password, protocol mismatch) means
 * it answered but is misconfigured: ERROR, so nobody goes looking for a network problem.
 */
export function statusAfterFailure(error: unknown): DeviceStatus {
  return error instanceof BiometricDeviceError && error.retryable ? 'OFFLINE' : 'ERROR';
}
