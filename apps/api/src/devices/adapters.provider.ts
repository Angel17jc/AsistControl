import type { Provider } from '@nestjs/common';
import {
  AdapterRegistry,
  MockDeviceAdapter,
  MockDeviceNetwork,
} from '@asistcontrol/biometric-core';
import { AppConfigService } from '../config/app-config.service';

export const ADAPTER_REGISTRY = Symbol('ADAPTER_REGISTRY');
export const MOCK_DEVICE_NETWORK = Symbol('MOCK_DEVICE_NETWORK');

/**
 * Composition root for device drivers: the ONLY place that knows concrete adapters.
 * A new manufacturer = implement BiometricDeviceAdapter in biometric-core and register it here.
 */
export const adapterProviders: Provider[] = [
  { provide: MOCK_DEVICE_NETWORK, useValue: new MockDeviceNetwork() },
  {
    provide: ADAPTER_REGISTRY,
    inject: [AppConfigService, MOCK_DEVICE_NETWORK],
    useFactory: (config: AppConfigService, network: MockDeviceNetwork) => {
      const registry = new AdapterRegistry();
      if (config.mockDevicesEnabled) {
        registry.register('MOCK', (connection) => {
          // Registering a mock device "powers on" a virtual terminal at that address.
          network.attach(connection.host, connection.port);
          return new MockDeviceAdapter(connection, network);
        });
      }
      // registry.register('ZKTECO', (c) => new ZKTecoAdapter(c));      → roadmap
      // registry.register('HIKVISION', (c) => new HikvisionAdapter(c)); → roadmap
      return registry;
    },
  },
];
