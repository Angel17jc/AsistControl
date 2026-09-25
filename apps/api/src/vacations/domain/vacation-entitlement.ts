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
  return counting === 'CALENDAR_DAYS' ? dates.length : dates.filter(isWorkingDay).length;
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
