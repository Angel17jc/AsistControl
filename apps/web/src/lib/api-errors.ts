import type {
  ApiErrorCode,
  ApiErrorParams,
  ApiErrorResponse,
  ApiViolation,
} from '@asistcontrol/shared';
import { REQUEST_STATUS } from '../components/status';
import { ROLE_LABEL } from './accounts';
import { formatDateWithYear, formatDays } from './format';

/**
 * Words the API's errors for the people using the app. The API says what happened with a code
 * and its data (ADR 0014); every error shown on screen goes through here, so no screen has to
 * know about it. The type asks for a text per code: a new one does not compile without it.
 */
const TEXTS: { [C in ApiErrorCode]: (params: ApiErrorParams[C]) => string } = {
  BAD_REQUEST: () => 'La solicitud no es válida. Revise los datos e intente de nuevo.',
  UNAUTHORIZED: () => 'Su sesión terminó. Vuelva a iniciar sesión.',
  FORBIDDEN: () => 'No tiene permiso para hacer esto.',
  NOT_FOUND: () => 'No se encontró lo que buscaba: puede que ya no exista.',
  CONFLICT: () => 'No se pudo completar porque los datos cambiaron. Recargue e intente de nuevo.',
  TOO_MANY_REQUESTS: () => 'Demasiados intentos. Espere un minuto y vuelva a intentarlo.',
  REQUEST_FAILED: () => 'No se pudo completar la solicitud. Revise los datos e intente de nuevo.',
  INTERNAL_ERROR: () => 'Ocurrió un error en el servidor. Si se repite, avise al administrador.',

  VALIDATION_FAILED: ({ violations }) => describeViolations(violations),
  DUPLICATE_RECORD: ({ fields }) =>
    fields.length > 0
      ? `Ya hay otro registro con el mismo valor en ${fields.map(quotedLabel).join(' y ')}.`
      : 'Ya hay otro registro con esos datos.',
  RECORD_IN_USE: () => 'No se pudo: ese registro no existe o lo están usando otros datos.',

  INVALID_CREDENTIALS: () => 'Correo o contraseña incorrectos.',
  SESSION_EXPIRED: () => 'Su sesión terminó. Vuelva a iniciar sesión.',
  CURRENT_PASSWORD_INCORRECT: () => 'La contraseña actual no es correcta.',
  PASSWORD_UNCHANGED: () => 'La contraseña nueva debe ser distinta de la actual.',
  PASSWORD_CHANGED_MEANWHILE: () =>
    'La contraseña se cambió desde otra sesión. Vuelva a iniciar sesión.',
  PASSWORD_CHANGE_REQUIRED: () => 'Debe elegir una contraseña nueva antes de continuar.',

  USER_NOT_FOUND: () => 'No se encontró esa cuenta: puede que ya no exista.',
  SELF_ACCOUNT_CHANGE: () => 'No puede cambiar su propio rol ni desactivar su propia cuenta.',
  ACCOUNT_NEEDS_EMPLOYEE: ({ role }) =>
    `Una cuenta de ${ROLE_LABEL[role]} debe estar vinculada a un empleado.`,
  ADMIN_ACCOUNTS_RESTRICTED: () =>
    'Solo un super administrador puede gestionar cuentas de administrador.',

  EMPLOYEE_NOT_FOUND: () => 'No se encontró ese empleado: puede que ya no exista.',
  EMPLOYEE_OUT_OF_SCOPE: () => 'No tiene acceso a los datos de ese empleado.',
  SUPERVISOR_IS_SELF: () => 'Un empleado no puede ser su propio supervisor.',
  RELATED_RECORD_NOT_FOUND: ({ record }) =>
    ({
      department: 'El departamento elegido ya no existe.',
      position: 'El cargo elegido ya no existe.',
      contractType: 'El tipo de contrato elegido ya no existe.',
      supervisor: 'El supervisor elegido ya no existe o no es válido.',
    })[record],
  DEPARTMENT_NOT_FOUND: () => 'No se encontró ese departamento: puede que ya no exista.',
  DEPARTMENT_IN_USE: ({ employees }) =>
    `No se puede eliminar: tiene ${employeesCount(employees)}. Asígnelos a otro departamento primero.`,
  POSITION_NOT_FOUND: () => 'No se encontró ese cargo: puede que ya no exista.',
  POSITION_IN_USE: ({ employees }) =>
    `No se puede eliminar: tiene ${employeesCount(employees)}. Asígnelos a otro cargo primero.`,
  CONTRACT_TYPE_NOT_FOUND: () => 'No se encontró ese tipo de contrato: puede que ya no exista.',
  CONTRACT_TYPE_IN_USE: ({ name, employees }) =>
    `No se puede eliminar «${name}»: tiene ${employeesCount(employees)}. Asígnelos a otro contrato primero.`,

  UNMATCHED_PUNCHES_FORBIDDEN: () => 'No tiene permiso para ver las marcaciones sin empleado.',
  PUNCH_IN_FUTURE: () => 'No se puede registrar una marcación en el futuro.',
  PUNCHES_AT_SAME_TIME: () => 'Dos de las marcaciones tienen la misma hora.',
  MANUAL_PUNCH_EXISTS: () => 'Ya hay una marcación manual de esta persona a esa hora.',
  EVENT_NOT_FOUND: () => 'No se encontró esa marcación.',
  EVENT_ALREADY_VOIDED: () => 'Esa marcación ya estaba anulada.',
  DATE_RANGE_INVERTED: () => 'La fecha «Desde» no puede ser posterior a «Hasta».',
  DATE_RANGE_TOO_LONG: ({ maxDays }) => `El período no puede pasar de ${maxDays} días.`,

  SHIFT_NOT_FOUND: () => 'No se encontró ese turno: puede que ya no exista.',
  SHIFTS_NOT_FOUND: () => 'Uno de los turnos elegidos ya no existe.',
  SCHEDULE_NOT_FOUND: () => 'No se encontró ese horario: puede que ya no exista.',
  HOLIDAY_NOT_FOUND: () => 'No se encontró ese feriado: puede que ya no exista.',
  FLEXIBLE_SHIFT_OVERNIGHT: () =>
    'Un turno sin hora fija no puede terminar al día siguiente: revise sus horas de referencia.',
  BREAK_INCOMPLETE: () => 'Indique el inicio y el fin del almuerzo, o deje los dos vacíos.',
  ASSIGNMENT_NOT_FOUND: () => 'No se encontró esa asignación de horario.',
  ASSIGNMENT_DATE_CONFLICT: () => 'Ya hay una asignación que empieza en esa fecha o después.',
  ASSIGNMENT_NOT_LATEST: () => 'Solo se puede deshacer la última asignación.',
  ASSIGNMENT_TOO_OLD: ({ maxDays }) =>
    `Solo se pueden deshacer asignaciones que empezaron hace menos de ${maxDays} días.`,

  DEVICE_NOT_FOUND: () => 'No se encontró ese dispositivo: puede que ya no exista.',
  DEVICE_DISABLED: () => 'El dispositivo está desactivado. Actívelo para usarlo.',
  DEVICE_ADDRESS_IN_USE: ({ name, host, port }) =>
    `El dispositivo «${name}» ya usa la dirección ${host}:${port}.`,
  DRIVER_NOT_AVAILABLE: ({ driver }) => `El driver ${driver} no está disponible en este servidor.`,
  SYNC_ALREADY_RUNNING: () => 'Ya hay una sincronización en curso. Espere a que termine.',
  MOCK_DEVICES_DISABLED: () => 'El simulador de dispositivos está apagado en este servidor.',
  SIMULATION_MOCK_ONLY: () => 'Esto solo está disponible en dispositivos simulados (MOCK).',
  SIMULATION_NO_BIOMETRIC_ID: () => 'Ese empleado no tiene ID biométrico.',
  SIMULATION_TARGET_REQUIRED: () => 'Indique un empleado o un ID biométrico.',

  LEAVE_NOT_FOUND: () => 'No se encontró esa solicitud: puede que ya no exista.',
  LEAVE_EMPLOYEE_REQUIRED: () =>
    'Su cuenta no está vinculada a un empleado, así que no puede hacer solicitudes a su nombre.',
  LEAVE_ENDS_BEFORE_START: () => '«Hasta» debe ser posterior a «Desde».',
  LEAVE_TOO_LONG: ({ maxDays }) => `Una solicitud no puede pasar de ${maxDays} días.`,
  LEAVE_OVERLAP: () => 'Ya hay una solicitud de esta persona que se cruza con esas fechas.',
  LEAVE_ALREADY_DECIDED: ({ status }) =>
    `Esta solicitud ya está ${REQUEST_STATUS[status].label.toLowerCase()}.`,
  LEAVE_SELF_REVIEW: () => 'No puede revisar su propia solicitud.',
  LEAVE_CANCEL_FORBIDDEN: () => 'Solo quien hizo la solicitud o Talento Humano pueden cancelarla.',
  VACATION_NO_COUNTABLE_DAYS: () =>
    'Esas fechas no incluyen ningún día que descuente vacaciones. Revise el período.',
  VACATION_INSUFFICIENT_BALANCE: ({ availableDays, requestedDays, startDate }) =>
    `Saldo de vacaciones insuficiente: al ${formatDateWithYear(startDate)} tendrá ` +
    `${formatDays(availableDays)} y esta solicitud usa ${formatDays(requestedDays)}.`,

  OVERTIME_NOT_FOUND: () => 'No se encontró ese registro de horas extra.',
  OVERTIME_SELF_REVIEW: () => 'No puede aprobar sus propias horas extra.',
  OVERTIME_ALREADY_DECIDED: ({ status }) =>
    `Estas horas extra ya se revisaron (${REQUEST_STATUS[status].label.toLowerCase()}).`,
  NOTIFICATION_NOT_FOUND: () => 'No se encontró esa notificación.',
  REPORT_FORMAT_UNSUPPORTED: () => 'Este reporte no se puede descargar en ese formato.',
  REPORT_UNKNOWN: () => 'Ese reporte no existe.',
};

/** How the form calls each property; what is not here is not something people fill in. */
const FIELD_LABEL: Record<string, string> = {
  afterYears: 'A partir de (años cumplidos)',
  biometricId: 'ID biométrico',
  breakEnd: 'Almuerzo hasta',
  breakStart: 'Almuerzo desde',
  code: 'Código',
  contractTypeId: 'Tipo de contrato',
  countEarlyArrivalAsOvertime: 'Contar la llegada anticipada como hora extra',
  credentials: 'Credenciales',
  currentPassword: 'Contraseña actual',
  date: 'Fecha',
  days: 'Días',
  departmentId: 'Departamento',
  description: 'Descripción',
  driver: 'Driver',
  duplicatePunchWindowSeconds: 'Marcación repetida',
  earlyLeaveToleranceMinutes: 'Tolerancia de salida',
  effectiveFrom: 'Desde',
  email: 'Correo',
  employeeCode: 'Código interno',
  employeeId: 'Empleado',
  endTime: 'Salida',
  endsAt: 'Hasta',
  extraDaysPerYear: 'Días extra por cada año más',
  firstName: 'Nombres',
  from: 'Desde',
  hireDate: 'Fecha de ingreso',
  host: 'IP / host',
  identification: 'Identificación',
  lastName: 'Apellidos',
  lateToleranceMinutes: 'Tolerancia de atraso',
  location: 'Ubicación',
  manufacturer: 'Fabricante',
  maxExtraDays: 'Máximo de días extra',
  minBreakMinutes: 'Almuerzo mínimo',
  model: 'Modelo',
  name: 'Nombre',
  newPassword: 'Contraseña nueva',
  note: 'Nota',
  occurredAt: 'Hora',
  outOfScheduleMarginMinutes: 'Margen fuera de horario',
  overtimeBasis: 'Qué cuenta como hora extra',
  overtimeThresholdMinutes: 'Mínimo para horas extra',
  password: 'Contraseña',
  phone: 'Teléfono',
  port: 'Puerto',
  positionId: 'Cargo',
  punchPairing: 'Entradas y salidas',
  punchType: 'Tipo',
  punchWindowAfterShiftMinutes: 'La jornada deja de contar',
  punchWindowBeforeShiftMinutes: 'La jornada empieza a contar',
  reason: 'Motivo',
  role: 'Rol',
  scheduleId: 'Horario',
  shiftId: 'Turno',
  startTime: 'Entrada',
  startsAt: 'Desde',
  status: 'Estado',
  supervisorId: 'Supervisor',
  terminatedAt: 'Fecha de baja',
  timezone: 'Zona horaria',
  to: 'Hasta',
  type: 'Tipo',
  vacationDaysPerYear: 'Días de vacaciones por año',
  vacationExpiryMonths: 'Meses para caducar',
};

/** A regular expression says nothing by itself: what each format asks for. */
const FORMAT_TEXT: Record<string, string> = {
  biometricId: 'use de 1 a 24 letras o números, sin espacios',
  breakEnd: 'no es una hora válida',
  breakStart: 'no es una hora válida',
  code: 'use de 2 a 20 letras mayúsculas, números, - o _',
  date: 'no es una fecha válida',
  effectiveFrom: 'no es una fecha válida',
  employeeCode: 'use de 2 a 20 letras, números o guiones, sin espacios',
  endTime: 'no es una hora válida',
  from: 'no es una fecha válida',
  hireDate: 'no es una fecha válida',
  identification: 'use de 5 a 20 letras, números o guiones',
  newPassword: 'use al menos 10 caracteres, con letras y números',
  password: 'use al menos 10 caracteres, con letras y números',
  phone: 'use de 6 a 20 caracteres: números, espacios, +, paréntesis o guiones',
  startTime: 'no es una hora válida',
  terminatedAt: 'no es una fecha válida',
  to: 'no es una fecha válida',
};

const RULE_TEXT: Record<string, string> = {
  arrayMaxSize: 'tiene demasiados elementos',
  arrayMinSize: 'faltan elementos',
  arrayUnique: 'tiene elementos repetidos',
  invalid_type: 'no es válido',
  invalid_value: 'no es una opción válida',
  isArray: 'no es válido',
  isBoolean: 'no es válido',
  isEmail: 'no es un correo válido',
  isHost: 'no es una dirección válida',
  isIn: 'no es una opción válida',
  isInt: 'debe ser un número entero',
  isIso8601: 'no es una fecha válida',
  isNumber: 'debe ser un número',
  isObject: 'no es válido',
  isString: 'es obligatorio',
  isTimeZone: 'no es una zona horaria válida',
  isUuid: 'no es una opción válida',
  max: 'supera el máximo permitido',
  maxLength: 'es demasiado largo',
  min: 'está por debajo del mínimo permitido',
  minLength: 'es demasiado corto',
  notEquals: 'no puede tener ese valor',
  too_big: 'supera el máximo permitido',
  too_small: 'está por debajo del mínimo permitido',
  unrecognized_keys: 'no se reconoce',
  whitelistValidation: 'no se reconoce',
};

/**
 * A missing value breaks every rule of its field, and only "it is required" makes sense then.
 * These come first: a value of the wrong kind says nothing about its length or range.
 */
const FIRST_RULES = ['isString', 'isInt', 'isNumber', 'isBoolean', 'isArray', 'isObject'];
/** Past this, a form has bigger problems: the rest would only make the message unreadable. */
const MAX_FIELDS_SHOWN = 4;

const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** The text for an error response, whatever it brought: a proxy's HTML page has no body. */
export function describeApiError(status: number, body: ApiErrorResponse | null): string {
  if (GATEWAY_STATUSES.has(status)) {
    return 'El servidor no está disponible en este momento. Intente de nuevo en unos minutos.';
  }
  const text = body?.code && Object.hasOwn(TEXTS, body.code) ? render(body) : forStatus(status);
  // The request id is what lets someone find the failure in the server's logs.
  return status >= 500 && body?.requestId ? `${text} Código: ${body.requestId}.` : text;
}

function render({ code, params }: ApiErrorResponse): string {
  try {
    return (TEXTS[code] as (p: typeof params) => string)(params);
  } catch {
    // A newer API may send other data for a code: better a plain text than a broken screen.
    return TEXTS.REQUEST_FAILED(undefined);
  }
}

/** A web older than the API, during an update, can receive a code it does not know yet. */
function forStatus(status: number): string {
  const byStatus: Record<number, ApiErrorCode> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    429: 'TOO_MANY_REQUESTS',
  };
  const code = byStatus[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
  return (TEXTS[code] as (params: undefined) => string)(undefined);
}

function describeViolations(violations: ApiViolation[]): string {
  const rulesByField = new Map<string, string[]>();
  for (const { field, rule } of violations) {
    rulesByField.set(field, [...(rulesByField.get(field) ?? []), rule]);
  }
  if (rulesByField.size === 0) return TEXTS.BAD_REQUEST(undefined);

  const lines = [...rulesByField]
    .slice(0, MAX_FIELDS_SHOWN)
    .map(([field, rules]) => `${labelOf(field)}: ${textOf(field, rules)}.`);
  const hidden = rulesByField.size - MAX_FIELDS_SHOWN;
  if (hidden > 0)
    lines.push(`Hay ${hidden} ${hidden === 1 ? 'dato más' : 'datos más'} por revisar.`);
  return lines.join(' ');
}

function textOf(field: string, rules: string[]): string {
  const rule = FIRST_RULES.find((r) => rules.includes(r)) ?? rules[0]!;
  const name = propertyOf(field);
  if (rule === 'matches') return lookup(FORMAT_TEXT, name) ?? 'no tiene el formato esperado';
  return lookup(RULE_TEXT, rule) ?? 'no es válido';
}

/** "punches.0.occurredAt" → "occurredAt": the form asks for that one, wherever it is nested. */
function propertyOf(field: string): string {
  return field.split('.').at(-1)!;
}

function labelOf(field: string): string {
  const name = propertyOf(field);
  return lookup(FIELD_LABEL, name) ?? name;
}

function quotedLabel(field: string): string {
  return `«${labelOf(field)}»`;
}

/** Field and rule names come from the server: never read them off an object's prototype. */
function lookup(texts: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(texts, key) ? texts[key] : undefined;
}

function employeesCount(employees: number): string {
  return employees === 1 ? '1 empleado' : `${employees} empleados`;
}
