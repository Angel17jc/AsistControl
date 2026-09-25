import { eachDate } from '../../common/utils/date-only';

/**
 * Vacation entitlement: how many days a person has earned by a given date.
 *
 * Pure (no Nest, no Prisma, no clock): dates are ISO local dates (`YYYY-MM-DD`) in the
 * company timezone, and every rule comes from the contract type. Nothing here encodes a
 * country's labor law — base days, accrual and seniority bonus are all configuration.
 */
export type VacationAccrual = 'ANNUAL' | 'MONTHLY';
export type VacationDayCounting = 'CALENDAR_DAYS' | 'WORKING_DAYS';

export interface VacationRule {
  daysPerYear: number;
  /**
   * ANNUAL: a service year's days are credited on its anniversary.
   * MONTHLY: a twelfth of the year's days is credited at each completed month of service.
   */
  accrual: VacationAccrual;
  /** Extra days per service year beyond `afterYears`, never more than `maxExtraDays`. */
  seniority: { afterYears: number; extraDaysPerYear: number; maxExtraDays: number } | null;
  /**
   * Unused days of a service year expire this many months after the year ends (its
   * anniversary); null = they never expire. See `vacation-expiry.ts`.
   */
  expiryMonths: number | null;
}

/** Days credited on a date, and the first date they can no longer be used (null = never). */
export interface VacationCredit {
  date: string;
  days: number;
  expiresOn: string | null;
}

export interface Accrual {
  accruedDays: number;
  completedServiceYears: number;
  /** Days the service year in progress is worth (base + seniority). */
  currentYearEntitlement: number;
  /** When the next credit lands; null once service has ended. */
  nextCreditOn: string | null;
}

/** Days owed for the n-th year of service (1-based): the base plus the seniority bonus. */
export function entitlementForServiceYear(rule: VacationRule, year: number): number {
  const bonus = rule.seniority
    ? Math.min(
        Math.max(0, year - rule.seniority.afterYears) * rule.seniority.extraDaysPerYear,
        rule.seniority.maxExtraDays,
      )
    : 0;
  return round(rule.daysPerYear + bonus);
}

/**
 * Days earned from `hireDate` up to and including `asOf`. Service stops on `terminatedOn`.
 * An anniversary (or monthiversary) falling exactly on `asOf` counts as completed.
 */
export function accruedVacationDays(
  rule: VacationRule,
  hireDate: string,
  asOf: string,
  terminatedOn: string | null = null,
): Accrual {
  const end = terminatedOn && terminatedOn < asOf ? terminatedOn : asOf;
  if (end < hireDate) {
    return {
      accruedDays: 0,
      completedServiceYears: 0,
      currentYearEntitlement: entitlementForServiceYear(rule, 1),
      nextCreditOn: terminatedOn && terminatedOn < hireDate ? null : firstCredit(rule, hireDate),
    };
  }

  let years = 0;
  while (addMonths(hireDate, (years + 1) * 12) <= end) years++;
  const credits = vacationCredits(rule, hireDate, asOf, terminatedOn);
  const serviceEnded = terminatedOn !== null && terminatedOn <= asOf;
  const periodMonths = rule.accrual === 'ANNUAL' ? 12 : 1;
  return {
    accruedDays: round(credits.reduce((sum, c) => sum + c.days, 0)),
    completedServiceYears: years,
    currentYearEntitlement: entitlementForServiceYear(rule, years + 1),
    nextCreditOn: serviceEnded ? null : addMonths(hireDate, (credits.length + 1) * periodMonths),
  };
}

/**
 * Each credit earned from `hireDate` up to and including `asOf` (service stops on
 * `terminatedOn`): one per anniversary with ANNUAL accrual, one per monthiversary with
 * MONTHLY. Every credit of a service year expires on the same date, `expiryMonths` after the
 * year's anniversary. Days are not rounded, so twelve twelfths add up to the year exactly.
 */
export function vacationCredits(
  rule: VacationRule,
  hireDate: string,
  asOf: string,
  terminatedOn: string | null = null,
): VacationCredit[] {
  const end = terminatedOn && terminatedOn < asOf ? terminatedOn : asOf;
  const expiresOn = (serviceYear: number) =>
    rule.expiryMonths === null ? null : addMonths(hireDate, serviceYear * 12 + rule.expiryMonths);
  const credits: VacationCredit[] = [];
  if (rule.accrual === 'ANNUAL') {
    for (let y = 1; addMonths(hireDate, y * 12) <= end; y++) {
      credits.push({
        date: addMonths(hireDate, y * 12),
        days: entitlementForServiceYear(rule, y),
        expiresOn: expiresOn(y),
      });
    }
    return credits;
  }
  for (let m = 1; addMonths(hireDate, m) <= end; m++) {
    const year = Math.ceil(m / 12);
    credits.push({
      date: addMonths(hireDate, m),
      days: entitlementForServiceYear(rule, year) / 12,
      expiresOn: expiresOn(year),
    });
  }
  return credits;
}

/**
 * Days a leave takes from the balance. `dates` are the local dates it covers; with
 * WORKING_DAYS only the employee's working days count (rest days and holidays are free).
 */
export function vacationDaysUsed(
  dates: string[],
  counting: VacationDayCounting,
  isWorkingDay: (date: string) => boolean,
): number {
  return dates.reduce((sum, date) => sum + vacationDayCost(counting, isWorkingDay(date), null), 0);
}

/**
 * What one date of a vacation costs. WORKING_DAYS leaves rest days and holidays free. With
 * half days allowed, a vacation within a single day is priced by the share of working time it
 * covers (`halfDayShare`); null prices whole days.
 */
export function vacationDayCost(
  counting: VacationDayCounting,
  isWorkingDay: boolean,
  halfDayShare: number | null,
): number {
  if (counting === 'WORKING_DAYS' && !isWorkingDay) return 0;
  return halfDayShare === null ? 1 : partialDayCost(halfDayShare);
}

export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Share (0-1) of a day's working time a leave covers: the shift minus its break when the day
 * has one, otherwise the whole `day`.
 */
export function coveredShare(
  leave: TimeRange,
  day: TimeRange,
  shift: (TimeRange & { break: TimeRange | null }) | null,
): number {
  const reference = shift ?? day;
  const pause = shift?.break ?? null;
  const total = overlap(reference, reference) - (pause ? overlap(pause, reference) : 0);
  if (total <= 0) return 0;
  const covered = overlap(leave, reference) - (pause ? overlap(leave, pause, reference) : 0);
  return Math.min(1, covered / total);
}

/**
 * What a leave within a single day costs when half days are allowed: nothing if it misses the
 * working time, half a day if it covers at most half of it, a whole day otherwise.
 */
export function partialDayCost(share: number): 0 | 0.5 | 1 {
  if (share <= 0) return 0;
  return share <= 0.5 ? 0.5 : 1;
}

/** Milliseconds shared by every range given. */
function overlap(...ranges: TimeRange[]): number {
  const start = Math.max(...ranges.map((r) => r.start.getTime()));
  const end = Math.min(...ranges.map((r) => r.end.getTime()));
  return Math.max(0, end - start);
}

/** Local dates an interval touches: from its first instant to its last (end exclusive). */
export function datesCovered(firstDate: string, lastDate: string): string[] {
  return lastDate < firstDate ? [] : eachDate(firstDate, lastDate);
}

/**
 * Same day `months` later. A day that does not exist in the target month (31st, or 29
 * February in a common year) falls on that month's last day.
 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function firstCredit(rule: VacationRule, hireDate: string): string {
  return addMonths(hireDate, rule.accrual === 'ANNUAL' ? 12 : 1);
}

/** Balances are shown and compared with two decimals (half days, monthly twelfths). */
export function round(days: number): number {
  return Math.round(days * 100) / 100;
}
