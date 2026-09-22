import type { BiometricDeviceAdapter } from './adapter';
import { UnsupportedDriverError } from './errors';
import type { DeviceConnectionConfig } from './types';

export type AdapterFactory = (config: DeviceConnectionConfig) => BiometricDeviceAdapter;

/**
 * Maps a driver key (MOCK, ZKTECO, ...) to the factory that builds its adapter.
 * The API registers the available drivers at bootstrap; nothing else knows concrete adapters.
 */
export class AdapterRegistry {
  private readonly factories = new Map<string, AdapterFactory>();

  register(driver: string, factory: AdapterFactory): this {
    if (this.factories.has(driver)) {
      throw new Error(`Driver "${driver}" is already registered`);
    }
    this.factories.set(driver, factory);
    return this;
  }

  has(driver: string): boolean {
    return this.factories.has(driver);
  }

  drivers(): string[] {
    return [...this.factories.keys()];
  }

  create(driver: string, config: DeviceConnectionConfig): BiometricDeviceAdapter {
    const factory = this.factories.get(driver);
    if (!factory) throw new UnsupportedDriverError(driver);
    return factory(config);
  }
}
