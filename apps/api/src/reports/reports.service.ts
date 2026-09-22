import { BadRequestException, Injectable } from '@nestjs/common';
import type { AttendanceStatus, Prisma } from '@prisma/client';
import { formatMinutes } from '@asistcontrol/shared';
import { DateTime } from 'luxon';
import { AccessScopeService } from '../common/access/access-scope.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { eachDate, fromDbDate, localDayBounds, toDbDate } from '../common/utils/date-only';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { type CsvColumn, toCsv } from './csv';
import type { ReportKind, ReportQueryDto } from './reports.dto';

const MAX_REPORT_DAYS = 93;
const MAX_ROWS = 50_000;

export interface Report {
  kind: ReportKind;
  from: string;
  to: string;
  rows: Record<string, string | number | boolean | null>[];
  columns: CsvColumn<Record<string, unknown>>[];
}

type Row = Record<string, string | number | boolean | null>;

/**
 * Read models for HR and payroll. Every report returns flat rows, so the same data feeds
 * the JSON API, the UI tables and the CSV export.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly settings: SettingsService,
  ) {}

  async build(kind: ReportKind, query: ReportQueryDto, user: AuthenticatedUser): Promise<Report> {
    let { from } = query;
    let to = query.to ?? query.from;
    if (kind === 'monthly') {
      const month = DateTime.fromISO(from, { zone: 'utc' });
      from = month.startOf('month').toISODate()!;
      to = month.endOf('month').toISODate()!;
    }
    if (from > to) throw new BadRequestException('"from" must be before "to"');
    if (eachDate(from, to).length > MAX_REPORT_DAYS)
      throw new BadRequestException(`Reports are limited to ${MAX_REPORT_DAYS} days`);

    const employeeWhere: Prisma.EmployeeWhereInput = {
      AND: [
        this.scope.employeeWhere(user) ?? {},
        query.departmentId ? { departmentId: query.departmentId } : {},
      ],
    };
    const range = { from, to };

    const rows = await this.rows(kind, range, employeeWhere);
    return { kind, from, to, rows, columns: columnsOf(rows) };
  }

  toCsv(report: Report): string {
    return toCsv(report.columns, report.rows);
  }

  private async rows(
    kind: ReportKind,
    range: { from: string; to: string },
    employee: Prisma.EmployeeWhereInput,
  ): Promise<Row[]> {
    switch (kind) {
      case 'daily':
        return this.recordRows(range, employee);
      case 'late':
        return this.recordRows(range, employee, { lateMinutes: { gt: 0 } });
      case 'absences':
        return this.recordRows(range, employee, { status: 'ABSENT' satisfies AttendanceStatus });
      case 'monthly':
        return this.monthlyRows(range, employee);
      case 'overtime':
        return this.overtimeRows(range, employee);
      case 'events':
        return this.eventRows(range, employee);
      case 'sync':
        return this.syncRows(range);
    }
  }

  private async recordRows(
    range: { from: string; to: string },
    employee: Prisma.EmployeeWhereInput,
    extra: Prisma.AttendanceRecordWhereInput = {},
  ): Promise<Row[]> {
    const timezone = await this.settings.getTimezone();
    const time = (d: Date | null) =>
      d ? DateTime.fromJSDate(d, { zone: timezone }).toFormat('HH:mm') : null;
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        workDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
        employee,
        ...extra,
      },
      include: {
        employee: {
          select: {
            employeeCode: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: [{ workDate: 'asc' }, { employee: { lastName: 'asc' } }],
      take: MAX_ROWS,
    });
    return records.map((r) => ({
      fecha: fromDbDate(r.workDate),
      codigo: r.employee.employeeCode,
      empleado: `${r.employee.lastName} ${r.employee.firstName}`,
      departamento: r.employee.department?.name ?? null,
      estado: r.status,
      horario: r.scheduledStart ? `${time(r.scheduledStart)}-${time(r.scheduledEnd)}` : null,
      entrada: time(r.firstIn),
      salida: time(r.lastOut),
      horas_trabajadas: formatMinutes(r.workedMinutes),
      minutos_trabajados: r.workedMinutes,
      minutos_atraso: r.lateMinutes,
      minutos_salida_anticipada: r.earlyLeaveMinutes,
      minutos_extra: r.overtimeMinutes,
      novedades: r.anomalies.join(' '),
      cerrado: r.isFinal,
    }));
  }

  private async monthlyRows(
    range: { from: string; to: string },
    employee: Prisma.EmployeeWhereInput,
  ): Promise<Row[]> {
    const where = { workDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) }, employee };
    const [employees, records, overtime] = await Promise.all([
      this.prisma.employee.findMany({
        where: { AND: [employee, { deletedAt: null }] },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          department: { select: { name: true } },
        },
        orderBy: { lastName: 'asc' },
      }),
      this.prisma.attendanceRecord.findMany({
        where,
        select: {
          employeeId: true,
          status: true,
          workedMinutes: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
        },
      }),
      this.prisma.overtimeRecord.findMany({
        where,
        select: { employeeId: true, status: true, minutes: true },
      }),
    ]);

    return employees.map((e) => {
      const own = records.filter((r) => r.employeeId === e.id);
      const ot = overtime.filter((o) => o.employeeId === e.id);
      const count = (...statuses: AttendanceStatus[]) =>
        own.filter((r) => statuses.includes(r.status)).length;
      const sum = (pick: (r: (typeof own)[number]) => number) =>
        own.reduce((s, r) => s + pick(r), 0);
      return {
        mes: range.from.slice(0, 7),
        codigo: e.employeeCode,
        empleado: `${e.lastName} ${e.firstName}`,
        departamento: e.department?.name ?? null,
        dias_asistidos: count('PRESENT', 'LATE', 'INCOMPLETE'),
        dias_atraso: own.filter((r) => r.lateMinutes > 0).length,
        ausencias: count('ABSENT'),
        dias_permiso: count('ON_LEAVE'),
        jornadas_incompletas: count('INCOMPLETE'),
        minutos_trabajados: sum((r) => r.workedMinutes),
        horas_trabajadas: formatMinutes(sum((r) => r.workedMinutes)),
        minutos_atraso: sum((r) => r.lateMinutes),
        minutos_salida_anticipada: sum((r) => r.earlyLeaveMinutes),
        minutos_extra_aprobados: ot
          .filter((o) => o.status === 'APPROVED')
          .reduce((s, o) => s + o.minutes, 0),
        minutos_extra_pendientes: ot
          .filter((o) => o.status === 'PENDING')
          .reduce((s, o) => s + o.minutes, 0),
      };
    });
  }

  private async overtimeRows(
    range: { from: string; to: string },
    employee: Prisma.EmployeeWhereInput,
  ): Promise<Row[]> {
    const rows = await this.prisma.overtimeRecord.findMany({
      where: { workDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) }, employee },
      include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
      orderBy: [{ workDate: 'asc' }],
      take: MAX_ROWS,
    });
    return rows.map((o) => ({
      fecha: fromDbDate(o.workDate),
      codigo: o.employee.employeeCode,
      empleado: `${o.employee.lastName} ${o.employee.firstName}`,
      tipo: o.kind,
      minutos: o.minutes,
      horas: formatMinutes(o.minutes),
      estado: o.status,
      revisado: o.reviewedAt?.toISOString() ?? null,
      nota: o.reviewNote,
    }));
  }

  private async eventRows(
    range: { from: string; to: string },
    employee: Prisma.EmployeeWhereInput,
  ): Promise<Row[]> {
    const timezone = await this.settings.getTimezone();
    const events = await this.prisma.attendanceEvent.findMany({
      where: {
        occurredAt: {
          gte: localDayBounds(range.from, timezone).from,
          lt: localDayBounds(range.to, timezone).to,
        },
        employee,
      },
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        device: { select: { name: true } },
      },
      orderBy: { occurredAt: 'asc' },
      take: MAX_ROWS,
    });
    return events.map((e) => ({
      fecha_hora: DateTime.fromJSDate(e.occurredAt, { zone: timezone }).toFormat(
        'yyyy-MM-dd HH:mm:ss',
      ),
      codigo: e.employee?.employeeCode ?? null,
      empleado: e.employee ? `${e.employee.lastName} ${e.employee.firstName}` : null,
      id_biometrico: e.deviceUserId,
      tipo: e.punchType,
      origen: e.source,
      dispositivo: e.device?.name ?? null,
      anulada: e.voidedAt !== null,
      nota: e.note ?? e.voidReason,
    }));
  }

  private async syncRows(range: { from: string; to: string }): Promise<Row[]> {
    const timezone = await this.settings.getTimezone();
    const logs = await this.prisma.deviceSyncLog.findMany({
      where: {
        startedAt: {
          gte: localDayBounds(range.from, timezone).from,
          lt: localDayBounds(range.to, timezone).to,
        },
      },
      include: { device: { select: { name: true } } },
      orderBy: { startedAt: 'asc' },
      take: MAX_ROWS,
    });
    return logs.map((l) => ({
      inicio: DateTime.fromJSDate(l.startedAt, { zone: timezone }).toFormat('yyyy-MM-dd HH:mm:ss'),
      dispositivo: l.device.name,
      origen: l.trigger,
      estado: l.status,
      recibidos: l.recordsReceived,
      procesados: l.recordsProcessed,
      duplicados: l.recordsDuplicated,
      rechazados: l.recordsRejected,
      sin_empleado: l.recordsUnmatched,
      duracion_ms: l.finishedAt ? l.finishedAt.getTime() - l.startedAt.getTime() : null,
      error: l.errorMessage,
    }));
  }
}

function columnsOf(rows: Row[]): CsvColumn<Record<string, unknown>>[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({ header: key, value: (r) => r[key] as Row[string] }));
}
