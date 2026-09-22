import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
  attendancePolicySchema,
} from '../attendance/domain/attendance-policy';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestContext } from '../common/auth/authenticated-user';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

const POLICY_KEY = 'attendance.policy';
const TIMEZONE_KEY = 'company.timezone';
const CACHE_TTL_MS = 30_000;

/**
 * Runtime-editable business settings with validated defaults. Reads are cached briefly
 * because the attendance engine consults the policy for every recomputation.
 */
@Injectable()
export class SettingsService {
  private cache: { policy: AttendancePolicy; timezone: string; loadedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async getAttendancePolicy(): Promise<AttendancePolicy> {
    return (await this.load()).policy;
  }

  async getTimezone(): Promise<string> {
    return (await this.load()).timezone;
  }

  async getAll() {
    const { policy, timezone } = await this.load();
    return { timezone, attendancePolicy: policy };
  }

  async updateAttendancePolicy(
    patch: Partial<AttendancePolicy>,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<AttendancePolicy> {
    const current = await this.getAttendancePolicy();
    const parsed = attendancePolicySchema.safeParse({ ...current, ...patch });
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.upsert(tx, POLICY_KEY, parsed.data, actor.id);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'settings.updated',
          entity: 'SystemSetting',
          entityId: POLICY_KEY,
          context,
          metadata: { before: current, after: parsed.data },
        },
        tx,
      );
    });
    this.cache = null;
    return parsed.data;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache;
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [POLICY_KEY, TIMEZONE_KEY] } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    // Stored values are merged over defaults so new policy fields get sane values after upgrades.
    const storedPolicy = (byKey.get(POLICY_KEY) ?? {}) as Partial<AttendancePolicy>;
    const policy = attendancePolicySchema.parse({ ...DEFAULT_ATTENDANCE_POLICY, ...storedPolicy });
    const timezone =
      (byKey.get(TIMEZONE_KEY) as string | undefined) ?? this.config.get('APP_TIMEZONE');

    this.cache = { policy, timezone, loadedAt: Date.now() };
    return this.cache;
  }

  private upsert(tx: Prisma.TransactionClient, key: string, value: unknown, actorId: string) {
    const json = value as Prisma.InputJsonValue;
    return tx.systemSetting.upsert({
      where: { key },
      create: { key, value: json, updatedById: actorId },
      update: { value: json, updatedById: actorId },
    });
  }
}
