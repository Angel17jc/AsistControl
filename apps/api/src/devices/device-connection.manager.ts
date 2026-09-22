import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Device } from '@prisma/client';
import type {
  AdapterRegistry,
  AttendanceLog,
  BiometricDeviceAdapter,
  DeviceConnectionConfig,
  Unsubscribe,
} from '@asistcontrol/biometric-core';
import { SecretBox } from '../common/crypto/secret-box';
import { AppConfigService } from '../config/app-config.service';
import { SettingsService } from '../settings/settings.service';
import { ADAPTER_REGISTRY } from './adapters.provider';

export type RealtimeLogHandler = (deviceId: string, log: AttendanceLog) => void;

interface DeviceConfig {
  timeoutMs?: number;
  realtime?: boolean;
  /** IANA timezone the terminal is configured with (defaults to the company timezone). */
  timezone?: string;
}

/**
 * Owns adapter instances. Services ask for "the adapter of device X" and never build one
 * themselves, so connection reuse, credential decryption and realtime subscriptions live
 * in a single place.
 */
@Injectable()
export class DeviceConnectionManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceConnectionManager.name);
  private readonly adapters = new Map<
    string,
    { version: number; adapter: BiometricDeviceAdapter }
  >();
  private readonly subscriptions = new Map<string, Unsubscribe>();
  private readonly secrets: SecretBox;
  private timezone: string;
  private realtimeHandler: RealtimeLogHandler | null = null;

  constructor(
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
    config: AppConfigService,
    private readonly settings: SettingsService,
  ) {
    this.secrets = new SecretBox(config.get('DEVICE_SECRETS_KEY'));
    this.timezone = config.get('APP_TIMEZONE');
  }

  /**
   * Default timezone handed to adapters whose devices do not declare their own.
   * Read once at startup: changing the company timezone is rare and restarting applies it.
   */
  async onModuleInit(): Promise<void> {
    this.timezone = await this.settings.getTimezone();
  }

  supportedDrivers(): string[] {
    return this.registry.drivers();
  }

  isSupported(driver: string): boolean {
    return this.registry.has(driver);
  }

  encryptCredentials(credentials: Record<string, string>): string {
    return this.secrets.encryptJson(credentials);
  }

  /** Returns a cached adapter, rebuilt whenever the device row changes. */
  adapterFor(device: Device): BiometricDeviceAdapter {
    const version = device.updatedAt.getTime();
    const cached = this.adapters.get(device.id);
    if (cached && cached.version === version) return cached.adapter;

    if (cached) void this.release(device.id);
    const adapter = this.registry.create(device.driver, this.connectionConfig(device));
    this.adapters.set(device.id, { version, adapter });
    return adapter;
  }

  /** Sync module registers where live punches must go. */
  onRealtimeLog(handler: RealtimeLogHandler): void {
    this.realtimeHandler = handler;
  }

  /** Connects and listens for live punches if the device and its driver support it. */
  async startRealtime(device: Device): Promise<boolean> {
    this.stopRealtime(device.id);
    const config = (device.config ?? {}) as DeviceConfig;
    if (device.status === 'DISABLED' || device.deletedAt || config.realtime === false) return false;
    if (!this.isSupported(device.driver)) return false;

    const adapter = this.adapterFor(device);
    if (!adapter.capabilities.realtime || !adapter.onAttendanceLog) return false;
    try {
      if (!adapter.isConnected()) await adapter.connect();
    } catch (err) {
      this.logger.warn(
        { deviceId: device.id, err: (err as Error).message },
        'Realtime connection failed',
      );
      return false;
    }
    const unsubscribe = adapter.onAttendanceLog((log) => this.realtimeHandler?.(device.id, log));
    this.subscriptions.set(device.id, unsubscribe);
    return true;
  }

  stopRealtime(deviceId: string): void {
    this.subscriptions.get(deviceId)?.();
    this.subscriptions.delete(deviceId);
  }

  async release(deviceId: string): Promise<void> {
    this.stopRealtime(deviceId);
    const cached = this.adapters.get(deviceId);
    this.adapters.delete(deviceId);
    await cached?.adapter.disconnect().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.adapters.keys()].map((id) => this.release(id)));
  }

  private connectionConfig(device: Device): DeviceConnectionConfig {
    const config = (device.config ?? {}) as DeviceConfig;
    return {
      host: device.host,
      port: device.port,
      timeoutMs: config.timeoutMs,
      credentials: device.credentialsEncrypted
        ? this.secrets.decryptJson(device.credentialsEncrypted)
        : undefined,
      // Terminals report local wall-clock time: the adapter needs the zone to build instants.
      options: { ...config, timezone: config.timezone ?? this.timezone },
    };
  }
}
