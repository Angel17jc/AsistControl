/**
 * Demo data for local development and reviews. Idempotent (upserts), so it can be re-run.
 * Holidays are SAMPLE data for Ecuador 2026 — verify against the official calendar before
 * using them in a real deployment; the system itself does not hardcode any country rules.
 */
import { PrismaClient, type Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'AsistControl2026';

const departments = [
  { code: 'ADM', name: 'Administración' },
  { code: 'OPS', name: 'Operaciones' },
  { code: 'TEC', name: 'Tecnología' },
  { code: 'RRHH', name: 'Talento Humano' },
];

const positions = [
  'Gerente',
  'Supervisor de Operaciones',
  'Analista',
  'Operario',
  'Guardia',
  'Desarrollador',
];

const employees = [
  {
    code: 'EMP-0001',
    id: '0900000001',
    first: 'Angel',
    last: 'Conforme',
    dept: 'TEC',
    pos: 'Desarrollador',
    bio: '1001',
    schedule: 'office',
  },
  {
    code: 'EMP-0002',
    id: '0900000002',
    first: 'María',
    last: 'Vera',
    dept: 'OPS',
    pos: 'Supervisor de Operaciones',
    bio: '1002',
    schedule: 'office',
  },
  {
    code: 'EMP-0003',
    id: '0900000003',
    first: 'Luis',
    last: 'Mendoza',
    dept: 'OPS',
    pos: 'Operario',
    bio: '1003',
    schedule: 'office',
    supervisor: 'EMP-0002',
  },
  {
    code: 'EMP-0004',
    id: '0900000004',
    first: 'Carla',
    last: 'Zambrano',
    dept: 'OPS',
    pos: 'Operario',
    bio: '1004',
    schedule: 'office',
    supervisor: 'EMP-0002',
  },
  {
    code: 'EMP-0005',
    id: '0900000005',
    first: 'Jorge',
    last: 'Macías',
    dept: 'OPS',
    pos: 'Operario',
    bio: '1005',
    schedule: 'office',
    supervisor: 'EMP-0002',
  },
  {
    code: 'EMP-0006',
    id: '0900000006',
    first: 'Andrea',
    last: 'Loor',
    dept: 'RRHH',
    pos: 'Analista',
    bio: '1006',
    schedule: 'office',
  },
  {
    code: 'EMP-0007',
    id: '0900000007',
    first: 'Pedro',
    last: 'Cedeño',
    dept: 'ADM',
    pos: 'Gerente',
    bio: '1007',
    schedule: 'office',
  },
  {
    code: 'EMP-0008',
    id: '0900000008',
    first: 'Sofía',
    last: 'Intriago',
    dept: 'TEC',
    pos: 'Analista',
    bio: '1008',
    schedule: 'office',
  },
  {
    code: 'EMP-0009',
    id: '0900000009',
    first: 'Diego',
    last: 'Palma',
    dept: 'OPS',
    pos: 'Guardia',
    bio: '1009',
    schedule: 'night',
    supervisor: 'EMP-0002',
  },
  {
    code: 'EMP-0010',
    id: '0900000010',
    first: 'Valeria',
    last: 'Andrade',
    dept: 'ADM',
    pos: 'Analista',
    bio: '1010',
    schedule: 'office',
  },
] as const;

const users: { email: string; role: Role; employee?: string }[] = [
  { email: 'admin@asistcontrol.local', role: 'SUPER_ADMIN' },
  { email: 'rrhh@asistcontrol.local', role: 'HR', employee: 'EMP-0006' },
  { email: 'supervisor@asistcontrol.local', role: 'SUPERVISOR', employee: 'EMP-0002' },
  { email: 'angel@asistcontrol.local', role: 'EMPLOYEE', employee: 'EMP-0001' },
];

const holidays2026 = [
  ['2026-01-01', 'Año Nuevo'],
  ['2026-02-16', 'Carnaval'],
  ['2026-02-17', 'Carnaval'],
  ['2026-04-03', 'Viernes Santo'],
  ['2026-05-01', 'Día del Trabajo'],
  ['2026-08-10', 'Primer Grito de Independencia'],
  ['2026-10-09', 'Independencia de Guayaquil'],
  ['2026-11-02', 'Día de los Difuntos'],
  ['2026-11-03', 'Independencia de Cuenca'],
  ['2026-12-25', 'Navidad'],
] as const;

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to seed demo data in production');
  }

  const deptIds = new Map<string, string>();
  for (const d of departments) {
    const row = await prisma.department.upsert({ where: { code: d.code }, update: {}, create: d });
    deptIds.set(d.code, row.id);
  }

  const positionIds = new Map<string, string>();
  for (const name of positions) {
    const row = await prisma.position.upsert({ where: { name }, update: {}, create: { name } });
    positionIds.set(name, row.id);
  }

  const office = await prisma.workShift.upsert({
    where: { name: 'Oficina 08:00-17:00' },
    update: {},
    create: {
      name: 'Oficina 08:00-17:00',
      startTime: '08:00',
      endTime: '17:00',
      breakStart: '12:00',
      breakEnd: '13:00',
    },
  });
  const night = await prisma.workShift.upsert({
    where: { name: 'Nocturno 22:00-06:00' },
    update: {},
    create: {
      name: 'Nocturno 22:00-06:00',
      startTime: '22:00',
      endTime: '06:00',
      breakStart: '02:00',
      breakEnd: '02:30',
      lateToleranceMinutes: 10,
    },
  });

  const weekdays = [1, 2, 3, 4, 5];
  const officeSchedule = await prisma.workSchedule.upsert({
    where: { name: 'Administrativo L-V' },
    update: {},
    create: {
      name: 'Administrativo L-V',
      days: { create: weekdays.map((weekday) => ({ weekday, shiftId: office.id })) },
    },
  });
  const nightSchedule = await prisma.workSchedule.upsert({
    where: { name: 'Vigilancia nocturna L-V' },
    update: {},
    create: {
      name: 'Vigilancia nocturna L-V',
      days: { create: weekdays.map((weekday) => ({ weekday, shiftId: night.id })) },
    },
  });

  const employeeIds = new Map<string, string>();
  for (const e of employees) {
    const row = await prisma.employee.upsert({
      where: { employeeCode: e.code },
      update: {},
      create: {
        employeeCode: e.code,
        identification: e.id,
        firstName: e.first,
        lastName: e.last,
        email: `${e.first}.${e.last}@empresa.local`
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase(),
        departmentId: deptIds.get(e.dept),
        positionId: positionIds.get(e.pos),
        hireDate: date('2025-01-06'),
        biometricId: e.bio,
      },
    });
    employeeIds.set(e.code, row.id);

    const hasAssignment = await prisma.employeeSchedule.count({ where: { employeeId: row.id } });
    if (!hasAssignment) {
      await prisma.employeeSchedule.create({
        data: {
          employeeId: row.id,
          scheduleId: e.schedule === 'night' ? nightSchedule.id : officeSchedule.id,
          effectiveFrom: date('2025-01-06'),
        },
      });
    }
  }
  for (const e of employees) {
    if ('supervisor' in e) {
      await prisma.employee.update({
        where: { employeeCode: e.code },
        data: { supervisorId: employeeIds.get(e.supervisor) },
      });
    }
  }

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        role: u.role,
        passwordHash,
        employeeId: u.employee ? employeeIds.get(u.employee) : undefined,
      },
    });
  }

  for (const [iso, name] of holidays2026) {
    await prisma.holiday.upsert({
      where: { date: date(iso) },
      update: {},
      create: { date: date(iso), name },
    });
  }

  const devices = [
    { name: 'Entrada principal', host: '192.168.1.201', location: 'Recepción - planta baja' },
    { name: 'Bodega', host: '192.168.1.202', location: 'Bodega norte' },
  ];
  for (const d of devices) {
    const exists = await prisma.device.findFirst({
      where: { host: d.host, port: 4370, deletedAt: null },
    });
    if (!exists) {
      await prisma.device.create({
        data: {
          ...d,
          port: 4370,
          driver: 'MOCK',
          manufacturer: 'AsistControl',
          model: 'AC-SIM-100',
          config: { realtime: true },
        },
      });
    }
  }

  console.log(`Seed completed. Demo users (password: ${DEMO_PASSWORD}):`);
  for (const u of users) console.log(`  ${u.role.padEnd(12)} ${u.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
