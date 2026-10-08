import { SystemClock } from '../../src/common/clock.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

describe('SystemClock', () => {
  const clock = new SystemClock();

  it('now() — настоящее время в epoch ms', () => {
    const before = Date.now();
    const now = clock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('sleep ждёт указанное время', async () => {
    jest.useFakeTimers();
    try {
      let done = false;
      const sleeping = clock.sleep(1000).then(() => (done = true));
      jest.advanceTimersByTime(999);
      await Promise.resolve();
      expect(done).toBe(false);
      jest.advanceTimersByTime(1);
      await sleeping;
      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sleep отклоняется с причиной отмены и снимает таймер', async () => {
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const sleeping = clock.sleep(60_000, controller.signal);
      controller.abort(new Error('shutdown'));
      await expect(sleeping).rejects.toThrow('shutdown');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sleep с уже отменённым сигналом отклоняется сразу', async () => {
    const signal = AbortSignal.abort(new Error('already'));
    await expect(clock.sleep(10, signal)).rejects.toThrow('already');
  });

  it('после пробуждения обработчик abort снят: поздняя отмена ни на что не влияет', async () => {
    const controller = new AbortController();
    await clock.sleep(1, controller.signal);
    expect(() => controller.abort()).not.toThrow();
  });
});

describe('FakeClock', () => {
  it('время стоит, пока его не сдвинут', async () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    await clock.advance(500);
    expect(clock.now()).toBe(1500);
  });

  it('будит спящих по порядку и только когда их время пришло', async () => {
    const clock = new FakeClock(0);
    const woke: string[] = [];
    void clock.sleep(300).then(() => woke.push(`b@${clock.now()}`));
    void clock.sleep(100).then(() => woke.push(`a@${clock.now()}`));
    await clock.advance(200);
    expect(woke).toEqual(['a@100']);
    expect(clock.pendingSleeps).toBe(1);
    await clock.advance(100);
    expect(woke).toEqual(['a@100', 'b@300']);
  });

  it('цепочка sleep внутри одного advance проходит целиком', async () => {
    const clock = new FakeClock(0);
    const stamps: number[] = [];
    const chain = (async () => {
      for (let i = 0; i < 3; i++) {
        await clock.sleep(1000);
        stamps.push(clock.now());
      }
    })();
    await clock.advance(5000);
    await chain;
    expect(stamps).toEqual([1000, 2000, 3000]);
    expect(clock.now()).toBe(5000);
  });

  it('отмена убирает спящего и отклоняет промис', async () => {
    const clock = new FakeClock();
    const controller = new AbortController();
    const sleeping = clock.sleep(1000, controller.signal);
    controller.abort(new Error('stop'));
    await expect(sleeping).rejects.toThrow('stop');
    expect(clock.pendingSleeps).toBe(0);
    await expect(clock.sleep(1, controller.signal)).rejects.toThrow('stop');
  });
});
