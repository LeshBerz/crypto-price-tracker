import { createEvent, InProcessEventBus, type AppEvent } from '../../src/events/event-bus.ts';
import { FakeClock } from '../helpers/fake-clock.ts';
import { createSpyLogger } from '../helpers/logger.ts';

describe('InProcessEventBus (ADR 0015 §3)', () => {
  const clock = new FakeClock();
  const event = () => createEvent('watchlist.changed', { cryptocurrencyId: 1, change: 'added' }, clock);

  it('конверт: uuid, версия 1, occurredAt по Clock', () => {
    expect(event()).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      type: 'watchlist.changed',
      version: 1,
      occurredAt: new Date(clock.now()).toISOString(),
      payload: { cryptocurrencyId: 1, change: 'added' },
    });
    expect(event().id).not.toBe(event().id);
  });

  it('доставляет подписчикам синхронно; после отписки — нет', () => {
    const bus = new InProcessEventBus(createSpyLogger().logger);
    const got: AppEvent[] = [];
    const unsubscribe = bus.subscribe('watchlist.changed', (e) => got.push(e));
    const first = event();
    bus.publish(first);
    expect(got).toEqual([first]);
    unsubscribe();
    bus.publish(event());
    expect(got).toHaveLength(1);
  });

  it('событие без подписчиков — не ошибка', () => {
    expect(() => new InProcessEventBus(createSpyLogger().logger).publish(event())).not.toThrow();
  });

  it('ошибка подписчика логируется и не ломает издателя и соседей', () => {
    const { logger, entries } = createSpyLogger();
    const bus = new InProcessEventBus(logger);
    const got: string[] = [];
    bus.subscribe('watchlist.changed', () => {
      throw new Error('потребитель упал');
    });
    bus.subscribe('watchlist.changed', (e) => got.push(e.id));
    const published = event();
    expect(() => bus.publish(published)).not.toThrow();
    expect(got).toEqual([published.id]);
    expect(entries()).toContainEqual(
      expect.objectContaining({ level: 'error', msg: 'event handler failed', eventId: published.id }),
    );
  });
});
