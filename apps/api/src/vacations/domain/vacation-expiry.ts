import { round, type VacationCredit } from './vacation-entitlement';

/**
 * Expiry of unused vacation days (carry-over limit).
 *
 * Pure, like the rest of the vacation domain. Credits are lots with an expiry date; days
 * taken are debits. Walking the timeline, each debit consumes the lots that expire first, so
 * nobody loses a day they could have used; whatever a lot still holds on its expiry date is
 * lost. Days taken beyond what is available (an advance) become a debt that the next credits
 * repay before anything else.
 */
export interface VacationDebit {
  date: string;
  days: number;
}

export interface ExpiryOutcome {
  /** Days lost up to `asOf`. */
  expiredDays: number;
  /**
   * The next date on which days expire and how many, counting the approved vacations planned
   * before it; null when nothing is due to expire.
   */
  nextExpiry: { date: string; days: number } | null;
}

interface Lot {
  expiresOn: string | null;
  remaining: number;
}

/** Float noise from twelfths: anything below this is zero. */
const EPSILON = 1e-9;

/**
 * @param debits days taken, before and after `asOf` (later ones only shape `nextExpiry`)
 * @param serviceEndsOn nothing expires after it: the balance of a person who left is settled
 */
export function simulateExpiry(
  credits: VacationCredit[],
  debits: VacationDebit[],
  asOf: string,
  serviceEndsOn: string | null = null,
): ExpiryOutcome {
  const lots: Lot[] = [];
  let debt = 0;
  let expiredDays = 0;
  const expiryStops = serviceEndsOn && serviceEndsOn < asOf ? serviceEndsOn : asOf;

  const expireUntil = (date: string) => {
    for (const lot of lots) {
      if (lot.expiresOn !== null && lot.expiresOn <= date && lot.expiresOn <= expiryStops) {
        expiredDays += lot.remaining;
        lot.remaining = 0;
      }
    }
  };
  const credit = (c: VacationCredit) => {
    const repaid = Math.min(debt, c.days);
    debt -= repaid;
    lots.push({ expiresOn: c.expiresOn, remaining: c.days - repaid });
  };
  const debit = (days: number) => {
    const uncovered = consume(lots, days);
    if (uncovered > EPSILON) debt += uncovered;
  };

  // On each date: first what expires that day, then new credits, then the days taken.
  const earned = credits.filter((c) => c.date <= asOf);
  const past = debits.filter((d) => d.date <= asOf);
  const dates = [...new Set([...earned.map((c) => c.date), ...past.map((d) => d.date)])].sort();
  for (const date of dates) {
    expireUntil(date);
    earned.filter((c) => c.date === date).forEach(credit);
    for (const d of past) if (d.date === date) debit(d.days);
  }
  expireUntil(asOf);

  return {
    expiredDays: round(expiredDays),
    nextExpiry: nextExpiry(lots, debits, asOf, serviceEndsOn),
  };
}

/**
 * Looks ahead from `asOf`: planned vacations use the soonest-expiring days first, and the first
 * lot that still holds days on its expiry date is the one to warn about.
 */
function nextExpiry(
  lots: Lot[],
  debits: VacationDebit[],
  asOf: string,
  serviceEndsOn: string | null,
): ExpiryOutcome['nextExpiry'] {
  if (serviceEndsOn !== null && serviceEndsOn <= asOf) return null;
  const future = debits.filter((d) => d.date > asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
  let next = 0;
  for (;;) {
    const due = byExpiry(lots).find((lot) => lot.expiresOn !== null && lot.remaining > EPSILON);
    if (!due) return null;
    const date = due.expiresOn!;
    if (serviceEndsOn !== null && serviceEndsOn < date) return null;
    while (next < future.length && future[next]!.date < date) {
      consume(lots, future[next]!.days);
      next++;
    }
    const days = lots
      .filter((lot) => lot.expiresOn === date)
      .reduce((sum, lot) => sum + lot.remaining, 0);
    if (days > EPSILON) return { date, days: round(days) };
    // Planned vacations use up that lot before it expires: look at the next one.
  }
}

/** Takes `days` from the lots that expire first; returns what they could not cover. */
function consume(lots: Lot[], days: number): number {
  let left = days;
  for (const lot of byExpiry(lots)) {
    if (left <= EPSILON) break;
    const taken = Math.min(lot.remaining, left);
    lot.remaining -= taken;
    left -= taken;
  }
  return left;
}

/** Lots with days left, soonest expiry first; never-expiring ones last. */
function byExpiry(lots: Lot[]): Lot[] {
  return lots
    .filter((lot) => lot.remaining > EPSILON)
    .sort((a, b) => {
      if (a.expiresOn === b.expiresOn) return 0;
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    });
}
