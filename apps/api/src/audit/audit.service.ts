import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from '../common/auth/authenticated-user';
import { paginate, skipTake } from '../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditQueryDto } from './dto/audit-query.dto';

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh_reuse_detected'
  | 'create'
  | 'update'
  | 'delete'
  | 'user.role_changed'
  | 'device.credentials_changed'
  | 'device.sync'
  | 'schedule.assigned'
  | 'attendance.manual_event'
  | 'attendance.event_voided'
  | 'attendance.recompute'
  | 'leave.reviewed'
  | 'overtime.reviewed'
  | 'settings.updated';

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  context?: RequestContext;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS = /password|secret|token|credential/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an audit entry. Accepts a transaction client so the audit row commits
   * atomically with the change it describes.
   */
  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        ip: entry.context?.ip ?? null,
        userAgent: entry.context?.userAgent ?? null,
        metadata: entry.metadata
          ? (redact(entry.metadata) as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  }

  /** Fire-and-forget variant for events outside a transaction (e.g. failed logins). */
  recordAsync(entry: AuditEntry): void {
    this.record(entry).catch((err: unknown) =>
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log'),
    );
  }

  async list(query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, email: true, role: true } } },
        ...skipTake(query),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(items, total, query);
  }
}

/** Keys that would reach Object.prototype if copied into a plain object (prototype pollution). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Defense in depth: never persist secrets in audit metadata even if a caller passes them. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !UNSAFE_KEYS.has(k))
        .map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

/** Shallow diff used for "update" audit entries. Keys come from request DTOs. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.keys(after)
      .filter((key) => !UNSAFE_KEYS.has(key))
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, { from: before[key], to: after[key] }]),
  );
}
