// Журнал запусков на настоящей SQLite :memory: (ADR 0009: БД не мокаем) — проверяем SQL и гарантию «один running».
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { createTestDb, T0 } from '../helpers/db.ts';

function setup() {
  const db = createTestDb();
  return { db, uow: new SqliteUnitOfWork(db) };
}

const done = { coinsRequested: 2, pricesSaved: 2, attempts: 1, creditsUsed: 1 };

describe('SqliteSyncRunRepository', () => {
  it('✅ start → finish: запись проходит running → succeeded со счётчиками', async () => {
    const { uow } = setup();
    const started = await uow.run((repos) => repos.syncRuns.start('manual', T0));
    expect(started).toEqual({
      id: 1,
      trigger: 'manual',
      status: 'running',
      startedAt: T0,
      finishedAt: null,
      coinsRequested: 0,
      pricesSaved: 0,
      attempts: 0,
      creditsUsed: null,
      errorCode: null,
      errorMessage: null,
    });

    const finished = await uow.run((repos) =>
      repos.syncRuns.finish(1, { status: 'succeeded', finishedAt: T0 + 500, ...done }),
    );
    expect(finished).toMatchObject({ status: 'succeeded', finishedAt: T0 + 500, ...done, errorCode: null });
    expect(await uow.run((repos) => repos.syncRuns.get(1))).toEqual(finished);
    expect(await uow.run((repos) => repos.syncRuns.get(2))).toBeNull();
  });

  it('❌ второй start при идущем запуске → null (индекс sync_runs_one_running), транзакция при этом жива', async () => {
    const { uow } = setup();
    await uow.run((repos) => repos.syncRuns.start('schedule', T0));
    const result = await uow.run(async (repos) => {
      const second = await repos.syncRuns.start('manual', T0 + 1);
      return { second, running: await repos.syncRuns.running() };
    });
    expect(result.second).toBeNull();
    expect(result.running).toMatchObject({ id: 1, trigger: 'schedule' });
  });

  it('❌ другая ошибка БД из start не глотается; finish несуществующего запуска — ошибка', async () => {
    const { uow } = setup();
    await expect(uow.run((repos) => repos.syncRuns.start('cron' as 'manual', T0))).rejects.toThrow(/CHECK/);
    await expect(
      uow.run((repos) => repos.syncRuns.finish(7, { status: 'failed', finishedAt: T0, ...done })),
    ).rejects.toThrow('7');
  });

  it('✅ failed сохраняет код и текст ошибки; latestAttempted находит последний исход нужного вида', async () => {
    const { uow } = setup();
    await uow.run(async ({ syncRuns }) => {
      expect(await syncRuns.latest()).toBeNull();
      expect(await syncRuns.running()).toBeNull();
      await syncRuns.start('startup', T0);
      await syncRuns.finish(1, { status: 'partial', finishedAt: T0 + 1, ...done });
      await syncRuns.start('schedule', T0 + 10);
      await syncRuns.finish(2, {
        status: 'failed',
        finishedAt: T0 + 11,
        ...done,
        pricesSaved: 0,
        creditsUsed: null,
        errorCode: 'CMC_TIMEOUT',
        errorMessage: 'timeout',
      });
    });
    await uow.run(async ({ syncRuns }) => {
      expect(await syncRuns.latest()).toMatchObject({ id: 2, errorCode: 'CMC_TIMEOUT', errorMessage: 'timeout' });
      expect(await syncRuns.latestAttempted(['succeeded', 'partial'])).toMatchObject({ id: 1 });
      expect(await syncRuns.latestAttempted(['failed'])).toMatchObject({ id: 2 });
      expect(await syncRuns.latestAttempted(['interrupted'])).toBeNull();
    });
  });

  it('✅ page: от новых к старым, keyset-курсор (startedAt, id)', async () => {
    const { db, uow } = setup();
    const insert = db.prepare(
      "INSERT INTO sync_runs (trigger, status, started_at, finished_at) VALUES ('manual', 'succeeded', ?, ?)",
    );
    // Запуски 2 и 3 стартовали в одну миллисекунду — порядок между ними задаёт id
    for (const startedAt of [T0, T0 + 5, T0 + 5, T0 + 9]) insert.run(BigInt(startedAt), BigInt(startedAt));

    const ids = (rows: { id: number }[]) => rows.map((row) => row.id);
    await uow.run(async ({ syncRuns }) => {
      expect(ids(await syncRuns.page(10, null))).toEqual([4, 3, 2, 1]);
      expect(ids(await syncRuns.page(2, null))).toEqual([4, 3]);
      expect(ids(await syncRuns.page(2, { at: T0 + 5, id: 3 }))).toEqual([2, 1]);
    });
  });

  it('✅ markInterrupted: зависший running → interrupted, finished_at не раньше started_at', async () => {
    const { uow } = setup();
    await uow.run(async ({ syncRuns }) => {
      expect(await syncRuns.markInterrupted(T0)).toBe(0);
      await syncRuns.start('schedule', T0);
      // Часы после рестарта отстали: finished_at всё равно не раньше started_at
      expect(await syncRuns.markInterrupted(T0 - 1000)).toBe(1);
      expect(await syncRuns.get(1)).toMatchObject({ status: 'interrupted', finishedAt: T0 });
      expect(await syncRuns.start('startup', T0 + 1)).toMatchObject({ id: 2, status: 'running' });
    });
  });
});
