import {
  type VacationRule,
  accruedVacationDays,
  addMonths,
  datesCovered,
  entitlementForServiceYear,
  vacationDaysUsed,
} from './vacation-entitlement';

/** Example values only: every number here is company configuration, not law. */
const ANNUAL: VacationRule = {
  daysPerYear: 15,
  accrual: 'ANNUAL',
  seniority: null,
  expiryMonths: null,
};
const MONTHLY: VacationRule = { ...ANNUAL, accrual: 'MONTHLY' };
const WITH_SENIORITY: VacationRule = {
  ...ANNUAL,
  seniority: { afterYears: 5, extraDaysPerYear: 1, maxExtraDays: 15 },
};

describe('entitlementForServiceYear', () => {
  it('adds the seniority bonus only after the configured years, up to its cap', () => {
    expect(
      [1, 5, 6, 7, 20, 21, 40].map((y) => entitlementForServiceYear(WITH_SENIORITY, y)),
    ).toEqual([15, 15, 16, 17, 30, 30, 30]);
  });

  it('supports fractional values (e.g. a part-time contract)', () => {
    expect(entitlementForServiceYear({ ...ANNUAL, daysPerYear: 7.5 }, 1)).toBe(7.5);
  });
});

describe('accruedVacationDays — annual accrual', () => {
  it('credits nothing before the first anniversary', () => {
    expect(accruedVacationDays(ANNUAL, '2025-03-10', '2026-03-09')).toMatchObject({
      accruedDays: 0,
      completedServiceYears: 0,
      nextCreditOn: '2026-03-10',
    });
  });

  it('credits a full year on the anniversary itself', () => {
    expect(accruedVacationDays(ANNUAL, '2025-03-10', '2026-03-10')).toMatchObject({
      accruedDays: 15,
      completedServiceYears: 1,
      nextCreditOn: '2027-03-10',
    });
  });

  it('adds seniority year by year', () => {
    // Years 1-5: 15 each; year 6: 16; year 7: 17 → 75 + 16 + 17.
    expect(accruedVacationDays(WITH_SENIORITY, '2019-01-02', '2026-01-02')).toMatchObject({
      accruedDays: 108,
      completedServiceYears: 7,
      currentYearEntitlement: 18,
    });
  });

  it('stops at the termination date', () => {
    expect(accruedVacationDays(ANNUAL, '2022-06-01', '2026-09-23', '2024-05-31')).toMatchObject({
      accruedDays: 15,
      completedServiceYears: 1,
      nextCreditOn: null,
    });
  });

  it('has nothing before the hire date', () => {
    expect(accruedVacationDays(ANNUAL, '2026-10-01', '2026-09-23').accruedDays).toBe(0);
  });

  it('moves a 29 February anniversary to 28 February in common years', () => {
    expect(accruedVacationDays(ANNUAL, '2024-02-29', '2025-02-27').accruedDays).toBe(0);
    expect(accruedVacationDays(ANNUAL, '2024-02-29', '2025-02-28').accruedDays).toBe(15);
    expect(accruedVacationDays(ANNUAL, '2024-02-29', '2028-02-28').completedServiceYears).toBe(3);
    expect(accruedVacationDays(ANNUAL, '2024-02-29', '2028-02-29').completedServiceYears).toBe(4);
  });
});

describe('accruedVacationDays — monthly accrual', () => {
  it('credits a twelfth per completed month', () => {
    expect(accruedVacationDays(MONTHLY, '2026-01-15', '2026-04-14').accruedDays).toBe(2.5);
    expect(accruedVacationDays(MONTHLY, '2026-01-15', '2026-04-15').accruedDays).toBe(3.75);
  });

  it('reaches exactly the annual figure after twelve months', () => {
    expect(accruedVacationDays(MONTHLY, '2025-01-15', '2026-01-15').accruedDays).toBe(15);
  });

  it('prices each month at the entitlement of its own service year', () => {
    const monthlySeniority: VacationRule = { ...WITH_SENIORITY, accrual: 'MONTHLY' };
    // Five full years (75) plus six months of year six (16 / 12 × 6 = 8).
    expect(accruedVacationDays(monthlySeniority, '2020-01-01', '2025-07-01').accruedDays).toBe(83);
  });

  it('handles hires on the 31st without drifting', () => {
    // 31 Jan → 28 Feb → 31 Mar: each monthiversary is computed from the hire date.
    expect(accruedVacationDays(MONTHLY, '2026-01-31', '2026-02-28').accruedDays).toBe(1.25);
    expect(accruedVacationDays(MONTHLY, '2026-01-31', '2026-03-30').accruedDays).toBe(1.25);
    expect(accruedVacationDays(MONTHLY, '2026-01-31', '2026-03-31').accruedDays).toBe(2.5);
  });
});

describe('days a leave uses', () => {
  const weekdays = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  // Friday 25 → Monday 28 September 2026.
  const dates = datesCovered('2026-09-25', '2026-09-28');

  it('counts every date with calendar days', () => {
    expect(vacationDaysUsed(dates, 'CALENDAR_DAYS', weekdays)).toBe(4);
  });

  it('counts only working days, so a weekend in the middle is free', () => {
    expect(vacationDaysUsed(dates, 'WORKING_DAYS', weekdays)).toBe(2);
  });

  it('covers nothing when the range is inverted', () => {
    expect(datesCovered('2026-09-28', '2026-09-25')).toEqual([]);
  });
});

describe('addMonths', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-11-15', 3, '2027-02-15'],
    ['2024-02-29', 12, '2025-02-28'],
  ])('%s + %i months = %s', (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });
});
