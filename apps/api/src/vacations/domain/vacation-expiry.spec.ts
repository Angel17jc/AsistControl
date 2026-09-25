import { type VacationRule, vacationCredits } from './vacation-entitlement';
import { simulateExpiry } from './vacation-expiry';

/** Example values only: every number here is company configuration, not law. */
const rule = (
  expiryMonths: number | null,
  accrual: 'ANNUAL' | 'MONTHLY' = 'ANNUAL',
): VacationRule => ({
  daysPerYear: 15,
  accrual,
  seniority: null,
  expiryMonths,
});
const HIRED = '2020-01-01';
const credits = (expiryMonths: number | null, asOf: string, terminatedOn: string | null = null) =>
  vacationCredits(rule(expiryMonths), HIRED, asOf, terminatedOn);
const taken = (date: string, days: number) => ({ date, days });

describe('vacationCredits', () => {
  it('dates each service year and when it expires', () => {
    expect(credits(12, '2022-06-30')).toEqual([
      { date: '2021-01-01', days: 15, expiresOn: '2022-01-01' },
      { date: '2022-01-01', days: 15, expiresOn: '2023-01-01' },
    ]);
    expect(credits(null, '2021-01-01')).toEqual([
      { date: '2021-01-01', days: 15, expiresOn: null },
    ]);
  });

  it('gives every twelfth of a year the expiry of that year', () => {
    const monthly = vacationCredits(rule(6, 'MONTHLY'), HIRED, '2021-02-01');
    expect(monthly).toHaveLength(13);
    expect(new Set(monthly.slice(0, 12).map((c) => c.expiresOn))).toEqual(new Set(['2021-07-01']));
    expect(monthly[12]).toEqual({ date: '2021-02-01', days: 1.25, expiresOn: '2022-07-01' });
  });
});

describe('simulateExpiry', () => {
  it('loses what is left of each year on its expiry date, not a day before', () => {
    expect(simulateExpiry(credits(12, '2021-12-31'), [], '2021-12-31')).toEqual({
      expiredDays: 0,
      nextExpiry: { date: '2022-01-01', days: 15 },
    });
    expect(simulateExpiry(credits(12, '2022-01-01'), [], '2022-01-01').expiredDays).toBe(15);
    expect(simulateExpiry(credits(12, '2023-06-01'), [], '2023-06-01')).toEqual({
      expiredDays: 30,
      nextExpiry: { date: '2024-01-01', days: 15 },
    });
  });

  it('only loses the unused part', () => {
    const outcome = simulateExpiry(
      credits(12, '2022-06-01'),
      [taken('2021-06-01', 10)],
      '2022-06-01',
    );
    expect(outcome.expiredDays).toBe(5);
  });

  it('spends the days that expire first', () => {
    // With 24 months both years are available in mid-2022; 20 days empty year one first.
    const outcome = simulateExpiry(
      credits(24, '2023-06-01'),
      [taken('2022-06-01', 20)],
      '2023-06-01',
    );
    expect(outcome).toEqual({
      expiredDays: 0,
      nextExpiry: { date: '2024-01-01', days: 10 },
    });
  });

  it('repays an advance with the next credit before anything can expire', () => {
    // 5 days taken before the first anniversary: only 10 of the 15 credited remain to lose.
    const outcome = simulateExpiry(
      credits(12, '2022-06-01'),
      [taken('2020-06-01', 5)],
      '2022-06-01',
    );
    expect(outcome.expiredDays).toBe(10);
  });

  it('spends never-expiring days (adjustments) last', () => {
    const withAdjustment = [
      ...credits(12, '2022-06-01'),
      { date: '2021-02-01', days: 10, expiresOn: null },
    ];
    const outcome = simulateExpiry(withAdjustment, [taken('2021-06-01', 12)], '2022-06-01');
    expect(outcome.expiredDays).toBe(3);
  });

  it('counts planned vacations when warning about the next expiry', () => {
    const asOf = '2021-06-01';
    const planned = (date: string, days: number) =>
      simulateExpiry(credits(12, asOf), [taken(date, days)], asOf).nextExpiry;

    expect(planned('2021-12-01', 5)).toEqual({ date: '2022-01-01', days: 10 });
    // A vacation after the expiry date cannot save those days.
    expect(planned('2022-02-01', 5)).toEqual({ date: '2022-01-01', days: 15 });
    // One that uses them all leaves nothing to warn about.
    expect(planned('2021-12-01', 15)).toBeNull();
  });

  it('moves on to the next year when planned vacations use up the first', () => {
    const asOf = '2022-06-01';
    const outcome = simulateExpiry(credits(24, asOf), [taken('2022-12-01', 15)], asOf);
    expect(outcome.nextExpiry).toEqual({ date: '2024-01-01', days: 15 });
  });

  it('stops expiring days once the person has left: their balance is settled', () => {
    const terminatedOn = '2021-06-01';
    const outcome = simulateExpiry(
      credits(12, '2023-01-01', terminatedOn),
      [],
      '2023-01-01',
      terminatedOn,
    );
    expect(outcome).toEqual({ expiredDays: 0, nextExpiry: null });
  });

  it('handles twelfths without float noise', () => {
    const monthly = vacationCredits(rule(6, 'MONTHLY'), HIRED, '2021-07-01');
    expect(simulateExpiry(monthly, [], '2021-07-01')).toEqual({
      expiredDays: 15,
      nextExpiry: { date: '2022-07-01', days: 7.5 },
    });
  });

  it('ignores credits after the date asked about', () => {
    const later = [...credits(12, '2021-06-01'), { date: '2021-09-01', days: 10, expiresOn: null }];
    // Seen from June, the 15 days of year one are all there is to use or lose.
    expect(simulateExpiry(later, [taken('2021-07-01', 20)], '2021-06-01').nextExpiry).toBeNull();
    expect(simulateExpiry(later, [taken('2021-07-01', 5)], '2021-06-01').nextExpiry).toEqual({
      date: '2022-01-01',
      days: 10,
    });
  });

  it('never expires anything without an expiry rule', () => {
    expect(simulateExpiry(credits(null, '2030-01-01'), [], '2030-01-01')).toEqual({
      expiredDays: 0,
      nextExpiry: null,
    });
  });
});
