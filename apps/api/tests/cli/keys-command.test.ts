import { ApiKeyAuthenticator } from '../../src/auth/api-key-authenticator.ts';
import { API_KEY_PATTERN, generateApiKey } from '../../src/auth/api-key.ts';
import { runKeysCommand, USAGE } from '../../src/cli/keys-command.ts';
import type { Database } from '../../src/db/database.ts';
import { SqliteUnitOfWork } from '../../src/db/unit-of-work.ts';
import { createTestDb } from '../helpers/db.ts';
import { FakeClock } from '../helpers/fake-clock.ts';

describe('CLI keys:create / keys:revoke (ADR 0002)', () => {
  let db: Database;
  let uow: SqliteUnitOfWork;
  let clock: FakeClock;
  let stdout: string[];
  let stderr: string[];
  const run = (argv: string[], generateKey?: () => string) =>
    runKeysCommand(argv, {
      uow,
      clock,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      generateKey,
    });
  const authenticate = (key: string) => new ApiKeyAuthenticator({ uow, clock }).authenticate(key);

  beforeEach(() => {
    db = createTestDb();
    uow = new SqliteUnitOfWork(db);
    clock = new FakeClock();
    stdout = [];
    stderr = [];
  });
  afterEach(() => db.close());

  describe('create', () => {
    it('✅ --role operator: ключ один раз в stdout, в БД — только хэш', async () => {
      await expect(run(['create', '--name', 'web-operator', '--role', 'operator'])).resolves.toBe(0);
      expect(stdout).toHaveLength(1);
      const key = stdout[0] as string;
      expect(key).toMatch(API_KEY_PATTERN);
      expect(stderr.join('\n')).not.toContain(key);
      expect(stderr[0]).toMatch(/Сохраните его сейчас/);
      expect(JSON.stringify(db.prepare('SELECT * FROM api_keys').all())).not.toContain(key.slice(12));
      expect((await authenticate(key))?.scopes.size).toBe(4);
    });

    it('✅ --scopes: список через запятую, пробелы и дубли не мешают', async () => {
      await expect(run(['create', '--name', 'monitoring', '--scopes', 'ops:read, prices:read,ops:read'])).resolves.toBe(
        0,
      );
      expect((await authenticate(stdout[0] as string))?.scopes).toEqual(new Set(['ops:read', 'prices:read']));
    });

    it('❌ имя занято → код 1, ключ не выдаётся', async () => {
      await run(['create', '--name', 'web', '--role', 'viewer']);
      stdout = [];
      await expect(run(['create', '--name', 'web', '--role', 'operator'])).resolves.toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.at(-1)).toBe('Ключ с именем «web» уже существует');
    });

    it('совпал префикс у сгенерированного ключа → берётся следующий', async () => {
      const first = generateApiKey();
      const clash = `${first.slice(0, 12)}${generateApiKey().slice(12)}`;
      const next = generateApiKey();
      const keys = [first, clash, next];
      const generate = () => keys.shift() as string;
      await run(['create', '--name', 'a', '--role', 'viewer'], generate);
      await expect(run(['create', '--name', 'b', '--role', 'viewer'], generate)).resolves.toBe(0);
      expect(stdout).toEqual([first, next]);
    });

    it('❌ префикс совпадает три раза подряд → исключение, ничего не записано', async () => {
      const key = generateApiKey();
      await run(['create', '--name', 'a', '--role', 'viewer'], () => key);
      await expect(run(['create', '--name', 'b', '--role', 'viewer'], () => key)).rejects.toThrow(
        /уникальным префиксом/,
      );
      expect(db.prepare('SELECT count(*) AS n FROM api_keys').get()).toEqual({ n: 1 });
    });

    it.each([
      ['нет --name', ['create', '--role', 'viewer'], '--name: обязательно'],
      ['имя длиннее 64', ['create', '--name', 'x'.repeat(65), '--role', 'viewer'], '--name: обязательно'],
      ['зарезервированный префикс', ['create', '--name', 'bootstrap-viewer', '--role', 'viewer'], 'зарезервирован'],
      ['нет ни --role, ни --scopes', ['create', '--name', 'x'], 'ровно одно'],
      ['и --role, и --scopes', ['create', '--name', 'x', '--role', 'viewer', '--scopes', 'ops:read'], 'ровно одно'],
      ['неизвестная роль', ['create', '--name', 'x', '--role', 'admin'], '--role: ожидается viewer или operator'],
      ['неизвестный scope', ['create', '--name', 'x', '--scopes', 'prices:read,admin'], 'admin'],
      ['пустые scopes', ['create', '--name', 'x', '--scopes', ' , '], '(пусто)'],
      ['неизвестный флаг', ['create', '--name', 'x', '--role', 'viewer', '--force'], "Unknown option '--force'"],
    ])('❌ %s → код 2 и подсказка', async (_case, argv, message) => {
      await expect(run(argv)).resolves.toBe(2);
      expect(stderr[0]).toContain(message);
      expect(stderr[0]).toContain(USAGE);
      expect(stdout).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('✅ отзывает ключ: дальше он получает отказ; повторный отзыв — тоже код 0', async () => {
      await run(['create', '--name', 'web', '--role', 'viewer']);
      const key = stdout[0] as string;
      await expect(run(['revoke', '--name', 'web'])).resolves.toBe(0);
      expect(stderr.at(-1)).toBe('Ключ «web» отозван');
      await expect(authenticate(key)).resolves.toBeNull();
      await expect(run(['revoke', '--name', 'web'])).resolves.toBe(0);
      expect(stderr.at(-1)).toBe('Ключ «web» уже был отозван');
    });

    it('❌ неизвестное имя → код 1', async () => {
      await expect(run(['revoke', '--name', 'ghost'])).resolves.toBe(1);
      expect(stderr).toEqual(['Ключ «ghost» не найден']);
    });
  });

  it.each([[[]], [['list']]])('❌ неизвестная команда %j → код 2', async (argv) => {
    await expect(run(argv)).resolves.toBe(2);
    expect(stderr[0]).toMatch(/^Неизвестная команда/);
  });

  it('прочие ошибки не маскируются под ошибку использования', async () => {
    db.close();
    await expect(run(['revoke', '--name', 'web'])).rejects.toThrow();
    db = createTestDb();
  });
});
