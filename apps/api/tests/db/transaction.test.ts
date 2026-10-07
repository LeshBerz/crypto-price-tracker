import { NestedTransactionError, TransactionRunner } from '../../src/db/transaction.ts';
import { openDatabase, type Database } from '../../src/db/database.ts';

describe('TransactionRunner', () => {
  let db: Database;
  let tx: TransactionRunner;
  const count = () => (db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }).n;
  const insert = (x: number) => db.prepare('INSERT INTO t (x) VALUES (?)').run(BigInt(x));

  beforeEach(() => {
    db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (x INTEGER NOT NULL) STRICT');
    tx = new TransactionRunner(db);
  });
  afterEach(() => db.close());

  it('✅ фиксирует изменения и возвращает результат', async () => {
    await expect(
      tx.run(async () => {
        insert(1);
        insert(2);
        return 'ok';
      }),
    ).resolves.toBe('ok');
    expect(count()).toBe(2);
  });

  it('❌ откатывает всё при исключении и пробрасывает ошибку', async () => {
    await expect(
      tx.run(async () => {
        insert(1);
        throw new Error('сбой посреди транзакции');
      }),
    ).rejects.toThrow('сбой посреди транзакции');
    expect(count()).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it('параллельные вызовы выполняются по очереди, а не вкладываются друг в друга', async () => {
    const order: string[] = [];
    const slow = tx.run(async () => {
      order.push('A:begin');
      insert(1);
      await new Promise((resolve) => setImmediate(resolve)); // настоящий переход через Event Loop
      order.push('A:commit');
    });
    const fast = tx.run(async () => {
      order.push('B:begin');
      insert(2);
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(['A:begin', 'A:commit', 'B:begin']);
    expect(count()).toBe(2);
  });

  it('ошибка одной транзакции не блокирует следующие', async () => {
    await expect(tx.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await tx.run(async () => insert(1));
    expect(count()).toBe(1);
  });

  it('❌ вложенный вызов — ошибка, а не взаимная блокировка', async () => {
    await expect(tx.run(() => tx.run(async () => insert(1)))).rejects.toThrow(NestedTransactionError);
    expect(count()).toBe(0);
  });
});
