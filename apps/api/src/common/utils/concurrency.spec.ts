import { forEachLimit } from './concurrency';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('forEachLimit', () => {
  it('runs every item, never more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await forEachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      done.push(n);
      running--;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = [];
    await expect(
      forEachLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await tick();
        if (n === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // 1 and 2 ran together; 3 started when 1 finished, before 2 failed. Nothing after.
    expect(started).toEqual([1, 2, 3]);
  });

  it('accepts an empty list and a limit below one', async () => {
    await expect(forEachLimit([], 4, async () => undefined)).resolves.toBeUndefined();
    const seen: string[] = [];
    await forEachLimit(['a', 'b'], 0, async (s) => void seen.push(s));
    expect(seen).toEqual(['a', 'b']);
  });
});
