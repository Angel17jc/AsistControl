import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type MockDeviceNetwork,
  type MockDeviceSimulator,
  WORKDAY_SCENARIOS,
  type WorkdayScenario,
} from '@asistcontrol/biometric-core';
import { DateTime } from 'luxon';
import { WorkCalendarService } from '../../attendance/work-calendar.service';
import { todayIn } from '../../common/utils/date-only';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { MOCK_DEVICE_NETWORK } from '../adapters.provider';
import { DevicesService } from '../devices.service';
import type { SimulateFaultsDto, SimulatePunchDto, SimulateWorkdayDto } from './simulation.dto';

/** Weighted distribution for MIXED days: mostly normal, some realistic problems. */
const MIXED_WEIGHTS: [WorkdayScenario, number][] = [
  ['ON_TIME', 60],
  ['LATE', 12],
  ['OVERTIME', 8],
  ['EARLY_LEAVE', 5],
  ['NO_LUNCH', 5],
  ['DUPLICATE_PUNCH', 4],
  ['MISSING_EXIT', 3],
  ['ABSENT', 3],
];

/**
 * Drives the virtual terminals of MOCK devices: punches, full work days and fault injection.
 * It only acts on the *device* side — data reaches the platform exclusively through the
 * normal sync/realtime pipeline, exactly like real hardware.
 */
@Injectable()
export class DeviceSimulationService {
  constructor(
    @Inject(MOCK_DEVICE_NETWORK) private readonly network: MockDeviceNetwork,
    private readonly devices: DevicesService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: AppConfigService,
    private readonly calendars: WorkCalendarService,
  ) {}

  async state(deviceId: string) {
    const sim = await this.simulator(deviceId);
    return {
      online: sim.isOnline(),
      autoGenerating: sim.autoGenerating,
      latencyMs: sim.latencyMs,
      clockSkewSeconds: Math.round(sim.clockSkewMs / 1000),
      duplicateOnRead: sim.duplicateOnRead,
      enrolledUsers: sim.listUsers().length,
      storedLogs: sim.readInfo().logCount,
    };
  }

  async punch(deviceId: string, dto: SimulatePunchDto) {
    const sim = await this.simulator(deviceId);
    let deviceUserId = dto.deviceUserId;
    if (dto.employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: dto.employeeId, deletedAt: null },
      });
      if (!employee?.biometricId) throw new BadRequestException('Employee has no biometricId');
      deviceUserId = employee.biometricId;
      sim.enrollUser({
        deviceUserId,
        name: `${employee.firstName} ${employee.lastName}`.toUpperCase(),
      });
    }
    if (!deviceUserId) throw new BadRequestException('Provide employeeId or deviceUserId');
    const log = sim.punch(deviceUserId, { punchType: dto.punchType });
    return { ...log, deviceOnline: sim.isOnline() };
  }

  async workday(deviceId: string, dto: SimulateWorkdayDto) {
    const sim = await this.simulator(deviceId);
    const timezone = await this.settings.getTimezone();
    const date = dto.date ?? todayIn(timezone);
    const utcOffsetMinutes = DateTime.fromISO(date, { zone: timezone }).offset;

    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        biometricId: { not: null },
        id: dto.employeeIds ? { in: dto.employeeIds } : undefined,
      },
      select: { id: true, firstName: true, lastName: true, biometricId: true },
    });

    // Each employee punches according to their real shift that day (night shifts included).
    const calendar = await this.calendars.load({
      employeeIds: employees.map((e) => e.id),
      from: date,
      to: date,
      timezone,
      policy: await this.settings.getAttendancePolicy(),
    });
    const hhmm = (d: Date | null) =>
      d ? DateTime.fromJSDate(d, { zone: timezone }).toFormat('HH:mm') : null;

    const scenario = dto.scenario ?? 'MIXED';
    const summary: Record<string, number> = {};
    let punches = 0;
    for (const e of employees) {
      const shift = calendar.dayFor(e.id, date).shift;
      if (!shift) {
        summary.NO_SHIFT = (summary.NO_SHIFT ?? 0) + 1;
        continue;
      }
      const template = {
        start: hhmm(shift.start)!,
        end: hhmm(shift.end)!,
        breakStart: hhmm(shift.breakStart),
        breakEnd: hhmm(shift.breakEnd),
      };
      const chosen = scenario === 'MIXED' ? pickWeighted() : scenario;
      sim.enrollUser({
        deviceUserId: e.biometricId!,
        name: `${e.firstName} ${e.lastName}`.toUpperCase(),
      });
      punches += sim.generateWorkday(e.biometricId!, {
        date,
        utcOffsetMinutes,
        scenario: chosen,
        template,
      }).length;
      summary[chosen] = (summary[chosen] ?? 0) + 1;
    }
    return {
      date,
      employees: employees.length,
      punches,
      scenarios: summary,
      hint: 'Run POST /devices/:id/sync to ingest past punches',
    };
  }

  async faults(deviceId: string, dto: SimulateFaultsDto) {
    const sim = await this.simulator(deviceId);
    if (dto.reset) {
      sim.clearFaults();
      sim.duplicateOnRead = false;
      sim.latencyMs = 0;
      sim.clockSkewMs = 0;
    }
    if (dto.online !== undefined) sim.setOnline(dto.online);
    if (dto.failNext) sim.failNext(dto.failNext);
    if (dto.dropConnectionAfter !== undefined) sim.dropConnectionAfter(dto.dropConnectionAfter);
    if (dto.duplicateOnRead !== undefined) sim.duplicateOnRead = dto.duplicateOnRead;
    if (dto.latencyMs !== undefined) sim.latencyMs = dto.latencyMs;
    if (dto.clockSkewSeconds !== undefined) sim.clockSkewMs = dto.clockSkewSeconds * 1000;
    return this.state(deviceId);
  }

  async auto(deviceId: string, intervalMs: number | undefined) {
    const sim = await this.simulator(deviceId);
    if (intervalMs && intervalMs > 0) {
      const employees = await this.prisma.employee.findMany({
        where: { deletedAt: null, status: 'ACTIVE', biometricId: { not: null } },
        select: { firstName: true, lastName: true, biometricId: true },
      });
      for (const e of employees) {
        sim.enrollUser({
          deviceUserId: e.biometricId!,
          name: `${e.firstName} ${e.lastName}`.toUpperCase(),
        });
      }
      sim.startAutoGeneration(Math.max(1_000, intervalMs));
    } else {
      sim.stopAutoGeneration();
    }
    return this.state(deviceId);
  }

  scenarios() {
    return [...WORKDAY_SCENARIOS, 'MIXED'];
  }

  private async simulator(deviceId: string): Promise<MockDeviceSimulator> {
    if (!this.config.mockDevicesEnabled) throw new NotFoundException('Mock devices are disabled');
    const device = await this.devices.getEntity(deviceId);
    if (device.driver !== 'MOCK')
      throw new BadRequestException('Simulation is only available for MOCK devices');
    return this.network.attach(device.host, device.port);
  }
}

function pickWeighted(): WorkdayScenario {
  const total = MIXED_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [scenario, weight] of MIXED_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return scenario;
  }
  return 'ON_TIME';
}
