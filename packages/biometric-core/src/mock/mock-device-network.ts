import { MockDeviceSimulator, type MockDeviceSimulatorOptions } from './mock-device-simulator';

/**
 * A fake LAN: resolves host:port to a virtual device, so several adapter instances
 * (e.g. one per sync run) reach the same simulated terminal, exactly like real hardware.
 */
export class MockDeviceNetwork {
  private readonly devices = new Map<string, MockDeviceSimulator>();

  attach(host: string, port: number, options?: MockDeviceSimulatorOptions): MockDeviceSimulator {
    const key = MockDeviceNetwork.key(host, port);
    const existing = this.devices.get(key);
    if (existing) return existing;
    const device = new MockDeviceSimulator({
      serialNumber: `MOCK-${host.replace(/\W/g, '')}-${port}`,
      ...options,
    });
    this.devices.set(key, device);
    return device;
  }

  resolve(host: string, port: number): MockDeviceSimulator | undefined {
    return this.devices.get(MockDeviceNetwork.key(host, port));
  }

  detach(host: string, port: number): void {
    const key = MockDeviceNetwork.key(host, port);
    this.devices.get(key)?.stopAutoGeneration();
    this.devices.delete(key);
  }

  private static key(host: string, port: number): string {
    return `${host.toLowerCase()}:${port}`;
  }
}
